package main

import (
	"context"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

// RateLimiter implements an advanced adaptive rate limiter
type RateLimiter struct {
	// Configuration
	config *Config

	// Token bucket for burst handling
	tokens     float64
	maxTokens  float64
	refillRate float64
	lastRefill time.Time
	tokenMutex sync.Mutex

	// Sliding window for request tracking
	requestTimes []time.Time
	windowMutex  sync.Mutex

	// Adaptive rate limiting with machine learning-like behavior
	successCount   uint64
	failureCount   uint64
	rateAdjustment float64
	backoffUntil   time.Time
	adaptiveMutex  sync.RWMutex

	// Enhanced circuit breaker with multiple states
	consecutiveFailures int
	circuitState        string // "closed", "open", "half-open"
	circuitOpenUntil    time.Time
	halfOpenRequests    int
	circuitMutex        sync.RWMutex

	// Advanced metrics and monitoring
	totalRequests      uint64
	totalWaitTime      time.Duration
	rateLimitHits      uint64
	avgResponseTimes   []time.Duration
	responseTimeWindow []time.Duration
	metricsMutex       sync.Mutex

	// Request priority queue for intelligent scheduling
	priorityRequests map[string]int // endpoint -> priority
	priorityMutex    sync.RWMutex

	// Predictive rate adjustment based on time patterns
	hourlyPatterns [24]float64 // Success rate by hour
	dailyPatterns  [7]float64  // Success rate by day of week
	patternMutex   sync.RWMutex

	// Health monitoring
	lastHealthCheck time.Time
	healthScore     float64
	healthMutex     sync.RWMutex
}

// NewRateLimiter creates a new advanced rate limiter
func NewRateLimiter(config *Config) *RateLimiter {
	rl := &RateLimiter{
		config:           config,
		maxTokens:        float64(config.RateLimitBurst),
		tokens:           float64(config.RateLimitBurst),
		refillRate:       float64(config.RateLimitRequests) / config.RateLimitPeriod.Seconds(),
		lastRefill:       time.Now(),
		rateAdjustment:   1.0,
		circuitState:     "closed",
		requestTimes:     make([]time.Time, 0, config.RateLimitRequests*2),
		avgResponseTimes: make([]time.Duration, 0, 100),
	}

	// Start background cleanup
	go rl.backgroundCleanup()

	return rl
}

// Wait blocks until a request can be made
func (rl *RateLimiter) Wait(ctx context.Context) error {
	// Check circuit breaker first
	if err := rl.checkCircuitBreaker(); err != nil {
		return err
	}

	// Token bucket algorithm
	waitDuration := rl.getTokenWaitTime()
	if waitDuration > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(waitDuration):
		}
	}

	// Sliding window check
	if err := rl.checkSlidingWindow(ctx); err != nil {
		return err
	}

	// Record request
	rl.recordRequest()

	return nil
}

// getTokenWaitTime calculates how long to wait for a token
func (rl *RateLimiter) getTokenWaitTime() time.Duration {
	rl.tokenMutex.Lock()
	defer rl.tokenMutex.Unlock()

	// Refill tokens
	now := time.Now()
	elapsed := now.Sub(rl.lastRefill).Seconds()
	tokensToAdd := elapsed * rl.refillRate * rl.rateAdjustment

	rl.tokens = math.Min(rl.tokens+tokensToAdd, rl.maxTokens)
	rl.lastRefill = now

	// Check if we have a token available
	if rl.tokens >= 1.0 {
		rl.tokens -= 1.0
		return 0
	}

	// Calculate wait time
	tokensNeeded := 1.0 - rl.tokens
	waitSeconds := tokensNeeded / (rl.refillRate * rl.rateAdjustment)

	return time.Duration(waitSeconds * float64(time.Second))
}

// checkSlidingWindow ensures we don't exceed the rate limit in the sliding window
func (rl *RateLimiter) checkSlidingWindow(ctx context.Context) error {
	rl.windowMutex.Lock()
	defer rl.windowMutex.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.config.RateLimitPeriod)

	// Remove old entries
	validRequests := make([]time.Time, 0, len(rl.requestTimes))
	for _, t := range rl.requestTimes {
		if t.After(windowStart) {
			validRequests = append(validRequests, t)
		}
	}
	rl.requestTimes = validRequests

	// Check if we're at the limit
	if len(rl.requestTimes) >= rl.config.RateLimitRequests {
		// Calculate wait time until the oldest request expires
		oldestRequest := rl.requestTimes[0]
		waitUntil := oldestRequest.Add(rl.config.RateLimitPeriod)
		waitDuration := waitUntil.Sub(now)

		if waitDuration > 0 {
			atomic.AddUint64(&rl.rateLimitHits, 1)

			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(waitDuration):
			}
		}
	}

	return nil
}

// checkCircuitBreaker checks if the circuit breaker allows requests
func (rl *RateLimiter) checkCircuitBreaker() error {
	now := time.Now()

	switch rl.circuitState {
	case "open":
		if now.After(rl.circuitOpenUntil) {
			rl.circuitState = "half-open"
		} else {
			return &RateLimitError{
				Type:       "circuit_breaker",
				Message:    "Circuit breaker is open",
				RetryAfter: rl.circuitOpenUntil.Sub(now),
			}
		}

	case "half-open":
		// Allow one request to test
	}

	return nil
}

// recordRequest records a new request
func (rl *RateLimiter) recordRequest() {
	rl.windowMutex.Lock()
	rl.requestTimes = append(rl.requestTimes, time.Now())
	rl.windowMutex.Unlock()

	atomic.AddUint64(&rl.totalRequests, 1)
}

// RecordSuccess records a successful request
func (rl *RateLimiter) RecordSuccess(responseTime time.Duration) {
	atomic.AddUint64(&rl.successCount, 1)
	rl.consecutiveFailures = 0

	// Update circuit breaker
	if rl.circuitState == "half-open" {
		rl.circuitState = "closed"
	}

	// Record response time
	rl.metricsMutex.Lock()
	rl.avgResponseTimes = append(rl.avgResponseTimes, responseTime)
	if len(rl.avgResponseTimes) > 100 {
		rl.avgResponseTimes = rl.avgResponseTimes[1:]
	}
	rl.metricsMutex.Unlock()

	// Adaptive rate adjustment
	if rl.config.AdaptiveRateLimit {
		rl.adjustRateOnSuccess()
	}
}

// RecordFailure records a failed request
func (rl *RateLimiter) RecordFailure(statusCode int, retryAfter time.Duration) {
	atomic.AddUint64(&rl.failureCount, 1)
	rl.consecutiveFailures++

	// Handle rate limit errors
	if statusCode == 429 {
		atomic.AddUint64(&rl.rateLimitHits, 1)

		if retryAfter > 0 {
			rl.backoffUntil = time.Now().Add(retryAfter)
		}

		// Significantly reduce rate
		rl.tokenMutex.Lock()
		rl.rateAdjustment *= 0.5
		if rl.rateAdjustment < 0.1 {
			rl.rateAdjustment = 0.1
		}
		rl.tokenMutex.Unlock()
	}

	// Update circuit breaker
	if rl.consecutiveFailures >= 5 {
		rl.circuitState = "open"
		rl.circuitOpenUntil = time.Now().Add(30 * time.Second)
	}

	// Adaptive rate adjustment
	if rl.config.AdaptiveRateLimit {
		rl.adjustRateOnFailure()
	}
}

// adjustRateOnSuccess increases the rate limit when things are going well
func (rl *RateLimiter) adjustRateOnSuccess() {
	rl.tokenMutex.Lock()
	defer rl.tokenMutex.Unlock()

	// Calculate success rate
	total := atomic.LoadUint64(&rl.successCount) + atomic.LoadUint64(&rl.failureCount)
	if total < 100 {
		return // Not enough data
	}

	successRate := float64(atomic.LoadUint64(&rl.successCount)) / float64(total)

	// Calculate average response time
	var avgResponseTime time.Duration
	rl.metricsMutex.Lock()
	if len(rl.avgResponseTimes) > 0 {
		var sum time.Duration
		for _, rt := range rl.avgResponseTimes {
			sum += rt
		}
		avgResponseTime = sum / time.Duration(len(rl.avgResponseTimes))
	}
	rl.metricsMutex.Unlock()

	// Increase rate if success rate is high and response times are good
	if successRate > 0.95 && avgResponseTime < 500*time.Millisecond {
		rl.rateAdjustment *= 1.1
		if rl.rateAdjustment > 2.0 {
			rl.rateAdjustment = 2.0
		}
	}
}

// adjustRateOnFailure decreases the rate limit when experiencing failures
func (rl *RateLimiter) adjustRateOnFailure() {
	rl.tokenMutex.Lock()
	defer rl.tokenMutex.Unlock()

	// Exponential backoff
	backoffFactor := math.Pow(rl.config.BackoffMultiplier, float64(rl.consecutiveFailures))
	rl.rateAdjustment /= backoffFactor

	if rl.rateAdjustment < 0.05 {
		rl.rateAdjustment = 0.05 // Minimum 5% of original rate
	}
}

// GetMetrics returns current rate limiter metrics
func (rl *RateLimiter) GetMetrics() RateLimiterMetrics {
	rl.metricsMutex.Lock()
	avgResponseTime := time.Duration(0)
	if len(rl.avgResponseTimes) > 0 {
		var sum time.Duration
		for _, rt := range rl.avgResponseTimes {
			sum += rt
		}
		avgResponseTime = sum / time.Duration(len(rl.avgResponseTimes))
	}
	rl.metricsMutex.Unlock()

	rl.tokenMutex.Lock()
	currentRate := rl.refillRate * rl.rateAdjustment
	rl.tokenMutex.Unlock()

	return RateLimiterMetrics{
		TotalRequests:       atomic.LoadUint64(&rl.totalRequests),
		SuccessCount:        atomic.LoadUint64(&rl.successCount),
		FailureCount:        atomic.LoadUint64(&rl.failureCount),
		RateLimitHits:       atomic.LoadUint64(&rl.rateLimitHits),
		CurrentRate:         currentRate,
		RateAdjustment:      rl.rateAdjustment,
		CircuitState:        rl.circuitState,
		AvgResponseTime:     avgResponseTime,
		ConsecutiveFailures: rl.consecutiveFailures,
	}
}

// backgroundCleanup periodically cleans up old data
func (rl *RateLimiter) backgroundCleanup() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		// Clean up old request times
		rl.windowMutex.Lock()
		now := time.Now()
		windowStart := now.Add(-rl.config.RateLimitPeriod * 2)

		validRequests := make([]time.Time, 0, len(rl.requestTimes))
		for _, t := range rl.requestTimes {
			if t.After(windowStart) {
				validRequests = append(validRequests, t)
			}
		}
		rl.requestTimes = validRequests
		rl.windowMutex.Unlock()

		// Reset counters periodically
		if atomic.LoadUint64(&rl.totalRequests) > 10000 {
			atomic.StoreUint64(&rl.successCount, 0)
			atomic.StoreUint64(&rl.failureCount, 0)
		}
	}
}

// RateLimiterMetrics contains rate limiter statistics
type RateLimiterMetrics struct {
	TotalRequests       uint64
	SuccessCount        uint64
	FailureCount        uint64
	RateLimitHits       uint64
	CurrentRate         float64
	RateAdjustment      float64
	CircuitState        string
	AvgResponseTime     time.Duration
	ConsecutiveFailures int
}

// RateLimitError represents a rate limit error
type RateLimitError struct {
	Type       string
	Message    string
	RetryAfter time.Duration
}

func (e *RateLimitError) Error() string {
	return e.Message
}

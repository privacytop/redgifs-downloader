package main

import (
	"testing"
	"time"
)

// TestConfig tests the configuration structure
func TestConfig(t *testing.T) {
	config := &Config{
		MaxConcurrentDownloads: 5,
		DownloadTimeout:        60 * time.Second,
		RetryAttempts:          3,
		RetryDelay:             2 * time.Second,
		APITimeout:             30 * time.Second,
		PageSize:               100,
		SearchOrders:           []string{"trending", "top", "recent"},
		UserAgent:              "RedGifs-Downloader/3.0.0",
		MaxRetries:             3,
		CacheExpiry:            5 * time.Minute,
		RateLimitRequests:      5,
		RateLimitPeriod:        time.Second,
		RateLimitBurst:         10,
		AdaptiveRateLimit:      true,
		BackoffMultiplier:      2.0,
		MaxBackoffDuration:     5 * time.Minute,
		DownloadPath:           "./downloads",
		DatabasePath:           "./test.db",
		PreferredQuality:       "hd",
		CreateUserFolders:      true,
		OverwriteExisting:      false,
		ShowProgress:           true,
	}

	// Test basic validation
	if config.MaxConcurrentDownloads <= 0 {
		t.Error("MaxConcurrentDownloads should be positive")
	}

	if config.DownloadTimeout <= 0 {
		t.Error("DownloadTimeout should be positive")
	}

	if config.PreferredQuality != "hd" && config.PreferredQuality != "sd" {
		t.Error("PreferredQuality should be 'hd' or 'sd'")
	}

	if len(config.SearchOrders) == 0 {
		t.Error("SearchOrders should not be empty")
	}
}

// TestDatabaseManager tests database operations
func TestDatabaseManager(t *testing.T) {
	// Create temporary database
	db := NewDatabaseManager(":memory:")
	
	err := db.Initialize()
	if err != nil {
		t.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Test token storage
	testToken := "test_token_123"
	err = db.StoreToken(testToken)
	if err != nil {
		t.Errorf("Failed to store token: %v", err)
	}

	retrievedToken, err := db.GetStoredToken()
	if err != nil {
		t.Errorf("Failed to get stored token: %v", err)
	}

	if retrievedToken != testToken {
		t.Errorf("Expected token %s, got %s", testToken, retrievedToken)
	}

	// Test token clearing
	err = db.ClearStoredToken()
	if err != nil {
		t.Errorf("Failed to clear token: %v", err)
	}

	clearedToken, err := db.GetStoredToken()
	if err != nil {
		t.Errorf("Failed to get token after clearing: %v", err)
	}

	if clearedToken != "" {
		t.Errorf("Expected empty token after clearing, got %s", clearedToken)
	}
}

// TestUtilityFunctions tests utility functions
func TestUtilityFunctions(t *testing.T) {
	// Test file size formatting
	testCases := []struct {
		bytes    int64
		expected string
	}{
		{0, "0 B"},
		{1024, "1.0 KB"},
		{1048576, "1.0 MB"},
		{1073741824, "1.0 GB"},
	}

	for _, tc := range testCases {
		result := FormatFileSize(tc.bytes)
		if result != tc.expected {
			t.Errorf("FormatFileSize(%d) = %s, expected %s", tc.bytes, result, tc.expected)
		}
	}

	// Test filename sanitization
	unsafeFilename := "test<>:\"/\\|?*file.mp4"
	safeFilename := SanitizeFilename(unsafeFilename)
	
	if safeFilename == unsafeFilename {
		t.Error("SanitizeFilename should modify unsafe filename")
	}

	// Test duration formatting
	duration := 125 * time.Second
	formatted := FormatDuration(duration)
	expected := "2m 5s"
	if formatted != expected {
		t.Errorf("FormatDuration(%v) = %s, expected %s", duration, formatted, expected)
	}
}

// TestRateLimiter tests rate limiting functionality
func TestRateLimiter(t *testing.T) {
	config := &Config{
		RateLimitRequests:  2,
		RateLimitPeriod:    time.Second,
		RateLimitBurst:     5,
		AdaptiveRateLimit:  false,
		BackoffMultiplier:  2.0,
		MaxBackoffDuration: 5 * time.Minute,
	}

	rateLimiter := NewRateLimiter(config)
	if rateLimiter == nil {
		t.Fatal("Failed to create rate limiter")
	}

	// Test basic rate limiting
	start := time.Now()
	
	// First request should be immediate
	err := rateLimiter.Wait()
	if err != nil {
		t.Errorf("First request failed: %v", err)
	}

	// Second request should also be immediate (within burst)
	err = rateLimiter.Wait()
	if err != nil {
		t.Errorf("Second request failed: %v", err)
	}

	elapsed := time.Since(start)
	if elapsed > 100*time.Millisecond {
		t.Errorf("Rate limiter took too long for burst requests: %v", elapsed)
	}
}

// TestCircuitBreaker tests circuit breaker functionality
func TestCircuitBreaker(t *testing.T) {
	cb := &CircuitBreaker{
		State:           "closed",
		FailureCount:    0,
		LastFailureTime: time.Time{},
		NextRetryTime:   time.Time{},
	}

	// Test initial state
	if cb.State != "closed" {
		t.Error("Circuit breaker should start in closed state")
	}

	if cb.FailureCount != 0 {
		t.Error("Circuit breaker should start with zero failures")
	}
}

// TestCacheEntry tests cache functionality
func TestCacheEntry(t *testing.T) {
	entry := &CacheEntry{
		Data:      "test data",
		ExpiresAt: time.Now().Add(5 * time.Minute),
		CreatedAt: time.Now(),
	}

	// Test cache entry is not expired
	if time.Now().After(entry.ExpiresAt) {
		t.Error("Cache entry should not be expired immediately after creation")
	}

	// Test data retrieval
	if entry.Data != "test data" {
		t.Errorf("Expected 'test data', got %v", entry.Data)
	}
}

// BenchmarkFormatFileSize benchmarks the file size formatting function
func BenchmarkFormatFileSize(b *testing.B) {
	for i := 0; i < b.N; i++ {
		FormatFileSize(1073741824) // 1 GB
	}
}

// BenchmarkSanitizeFilename benchmarks the filename sanitization function
func BenchmarkSanitizeFilename(b *testing.B) {
	unsafeFilename := "test<>:\"/\\|?*file.mp4"
	for i := 0; i < b.N; i++ {
		SanitizeFilename(unsafeFilename)
	}
}

// TestMain sets up and tears down test environment
func TestMain(m *testing.M) {
	// Setup test environment
	// Run tests
	m.Run()
	// Cleanup test environment
}

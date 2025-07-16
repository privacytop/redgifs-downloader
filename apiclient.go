package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	baseURL = "https://api.redgifs.com/v2"
)

// RedGifsAPI handles all API interactions with enhanced error handling and retry mechanisms
type RedGifsAPI struct {
	client      *http.Client
	rateLimiter *RateLimiter
	config      *Config

	// Authentication
	token       string
	tokenExpiry time.Time
	tokenMutex  sync.RWMutex

	// Enhanced metrics and monitoring
	requestCount    uint64
	errorCount      uint64
	retryCount      uint64
	avgResponseTime time.Duration
	lastError       error
	lastErrorTime   time.Time
	metricsMutex    sync.RWMutex

	// Circuit breaker for API health
	circuitBreaker *CircuitBreaker

	// Request cache for reducing API calls
	cache      map[string]*CacheEntry
	cacheMutex sync.RWMutex
}

// NewRedGifsAPI creates a new API client
func NewRedGifsAPI(config *Config) *RedGifsAPI {
	client := &http.Client{
		Timeout: config.APITimeout,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	return &RedGifsAPI{
		client:         client,
		rateLimiter:    NewRateLimiter(config),
		config:         config,
		circuitBreaker: &CircuitBreaker{State: "closed"},
		cache:          make(map[string]*CacheEntry),
	}
}

// SetToken sets the authentication token
func (api *RedGifsAPI) SetToken(token string) {
	api.tokenMutex.Lock()
	defer api.tokenMutex.Unlock()
	api.token = token
	api.tokenExpiry = time.Now().Add(55 * time.Minute) // Tokens typically last 1 hour
}

// GetToken gets or refreshes the authentication token
func (api *RedGifsAPI) GetToken() (string, error) {
	api.tokenMutex.RLock()
	if api.token != "" && time.Now().Before(api.tokenExpiry) {
		token := api.token
		api.tokenMutex.RUnlock()
		return token, nil
	}
	api.tokenMutex.RUnlock()

	// Get temporary token
	return api.getTemporaryToken()
}

// getTemporaryToken gets a temporary API token
func (api *RedGifsAPI) getTemporaryToken() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := api.doRequest(ctx, "GET", "/auth/temporary", nil, nil, false)
	if err != nil {
		return "", fmt.Errorf("failed to get token: %w", err)
	}

	var tokenResp APITokenResponse
	if err := json.Unmarshal(resp, &tokenResp); err != nil {
		return "", fmt.Errorf("failed to parse token response: %w", err)
	}

	api.SetToken(tokenResp.Token)
	return tokenResp.Token, nil
}

// ClearToken clears the authentication token
func (api *RedGifsAPI) ClearToken() {
	api.tokenMutex.Lock()
	defer api.tokenMutex.Unlock()
	api.token = ""
	api.tokenExpiry = time.Time{}
}

// IsAuthenticated checks if the user is authenticated
func (api *RedGifsAPI) IsAuthenticated() bool {
	api.tokenMutex.RLock()
	defer api.tokenMutex.RUnlock()
	return api.token != "" && strings.Contains(api.token, ".")
}

// GetUserProfile gets the authenticated user's profile
func (api *RedGifsAPI) GetUserProfile() (*APIUserResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resp, err := api.doRequest(ctx, "GET", "/me", nil, nil, true)
	if err != nil {
		return nil, err
	}

	var profile APIUserResponse
	if err := json.Unmarshal(resp, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse profile: %w", err)
	}

	return &profile, nil
}

// SearchUsers searches for users
func (api *RedGifsAPI) SearchUsers(query string) ([]*UserResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"search_text": {query},
		"count":       {"20"},
	}

	resp, err := api.doRequest(ctx, "GET", "/users/search", params, nil, true)
	if err != nil {
		return nil, err
	}

	var result struct {
		Users []APIUserResponse `json:"users"`
	}

	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse users: %w", err)
	}

	users := make([]*UserResult, len(result.Users))
	for i, u := range result.Users {
		users[i] = &UserResult{
			Username:        u.Username,
			Name:            u.Name,
			ProfileImageURL: u.ProfileImageURL,
			ProfileURL:      u.ProfileURL,
			Followers:       u.Followers,
			Gifs:            u.Gifs,
			Views:           u.Views,
			Verified:        u.Verified,
		}
	}

	return users, nil
}

// GetUserContent gets content for a specific user
func (api *RedGifsAPI) GetUserContent(username, searchOrder string, page int) (*ContentResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"order": {searchOrder},
		"count": {fmt.Sprintf("%d", api.config.PageSize)},
		"page":  {fmt.Sprintf("%d", page)},
	}

	endpoint := fmt.Sprintf("/users/%s/search", username)
	resp, err := api.doRequest(ctx, "GET", endpoint, params, nil, true)
	if err != nil {
		return nil, err
	}

	var apiResp APIContentResponse
	if err := json.Unmarshal(resp, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse content: %w", err)
	}

	return api.convertContentResponse(&apiResp), nil
}

// GetLikedContent gets the authenticated user's liked content
func (api *RedGifsAPI) GetLikedContent(page int) (*ContentResponse, error) {
	if !api.IsAuthenticated() {
		return nil, fmt.Errorf("authentication required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"page":  {fmt.Sprintf("%d", page)},
		"count": {fmt.Sprintf("%d", api.config.PageSize)},
	}

	resp, err := api.doRequest(ctx, "GET", "/feeds/liked", params, nil, true)
	if err != nil {
		return nil, err
	}

	var apiResp APIContentResponse
	if err := json.Unmarshal(resp, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse liked content: %w", err)
	}

	return api.convertContentResponse(&apiResp), nil
}

// doRequest performs an HTTP request with rate limiting and retries
func (api *RedGifsAPI) doRequest(ctx context.Context, method, endpoint string, params url.Values, body io.Reader, requireAuth bool) ([]byte, error) {
	// Rate limiting
	if err := api.rateLimiter.Wait(ctx); err != nil {
		return nil, fmt.Errorf("rate limit: %w", err)
	}

	// Build URL
	u, err := url.Parse(baseURL + endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid endpoint: %w", err)
	}
	if params != nil {
		u.RawQuery = params.Encode()
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add headers
	req.Header.Set("User-Agent", "RedGifs-Downloader/2.0")
	req.Header.Set("Accept", "application/json")

	if requireAuth {
		token, err := api.GetToken()
		if err != nil {
			return nil, fmt.Errorf("failed to get token: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
	}

	// Retry logic
	var lastErr error
	for attempt := 0; attempt <= api.config.RetryAttempts; attempt++ {
		if attempt > 0 {
			// Exponential backoff
			backoff := time.Duration(attempt) * api.config.RetryDelay
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		// Make request
		startTime := time.Now()
		resp, err := api.client.Do(req)
		responseTime := time.Since(startTime)

		if err != nil {
			lastErr = err
			api.rateLimiter.RecordFailure(0, 0)
			continue
		}

		defer resp.Body.Close()

		// Read response
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			api.rateLimiter.RecordFailure(resp.StatusCode, 0)
			continue
		}

		// Handle status codes
		switch resp.StatusCode {
		case http.StatusOK:
			api.rateLimiter.RecordSuccess(responseTime)
			return data, nil

		case http.StatusTooManyRequests:
			// Parse rate limit response
			var errResp APIErrorResponse
			json.Unmarshal(data, &errResp)

			retryAfter := time.Duration(errResp.Error.Delay) * time.Second
			if retryAfter == 0 {
				retryAfter = 60 * time.Second
			}

			api.rateLimiter.RecordFailure(resp.StatusCode, retryAfter)
			lastErr = fmt.Errorf("rate limited: retry after %v", retryAfter)

			// Wait for rate limit to expire
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(retryAfter):
			}

		case http.StatusUnauthorized:
			if requireAuth && attempt == 0 {
				// Clear token and retry once
				api.ClearToken()
				continue
			}
			api.rateLimiter.RecordFailure(resp.StatusCode, 0)
			return nil, fmt.Errorf("unauthorized: %s", string(data))

		case http.StatusNotFound:
			api.rateLimiter.RecordSuccess(responseTime)
			return nil, fmt.Errorf("not found: %s", endpoint)

		default:
			api.rateLimiter.RecordFailure(resp.StatusCode, 0)
			lastErr = fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
		}
	}

	return nil, fmt.Errorf("max retries exceeded: %w", lastErr)
}

// convertContentResponse converts API response to internal format
func (api *RedGifsAPI) convertContentResponse(apiResp *APIContentResponse) *ContentResponse {
	contents := make([]*Content, len(apiResp.Gifs))

	for i, gif := range apiResp.Gifs {
		contents[i] = &Content{
			ID:          gif.ID,
			Description: gif.Description,
			Duration:    gif.Duration,
			Width:       gif.Width,
			Height:      gif.Height,
			Views:       gif.Views,
			Likes:       gif.Likes,
			Username:    gif.UserName,
			CreateDate:  gif.CreateDate,
			HasAudio:    gif.HasAudio,
			URLs: ContentURLs{
				HD:        gif.URLs["hd"],
				SD:        gif.URLs["sd"],
				Thumbnail: gif.URLs["thumbnail"],
				Poster:    gif.URLs["poster"],
			},
			Tags:   gif.Tags,
			Niches: gif.Niches,
		}
	}

	var nextPage *int
	if apiResp.Page < apiResp.Pages {
		next := apiResp.Page + 1
		nextPage = &next
	}

	return &ContentResponse{
		Contents: contents,
		Page:     apiResp.Page,
		Pages:    apiResp.Pages,
		Total:    apiResp.Total,
		NextPage: nextPage,
	}
}

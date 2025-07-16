package main

import (
	"context"
	"time"
)

// Config holds application configuration
type Config struct {
	// Download settings
	MaxConcurrentDownloads int           `json:"max_concurrent_downloads"`
	DownloadTimeout        time.Duration `json:"download_timeout"`
	RetryAttempts          int           `json:"retry_attempts"`
	RetryDelay             time.Duration `json:"retry_delay"`

	// API settings
	APITimeout   time.Duration `json:"api_timeout"`
	PageSize     int           `json:"page_size"`
	SearchOrders []string      `json:"search_orders"`
	UserAgent    string        `json:"user_agent"`
	MaxRetries   int           `json:"max_retries"`
	CacheExpiry  time.Duration `json:"cache_expiry"`

	// Rate limiting
	RateLimitRequests  int           `json:"rate_limit_requests"`
	RateLimitPeriod    time.Duration `json:"rate_limit_period"`
	RateLimitBurst     int           `json:"rate_limit_burst"`
	AdaptiveRateLimit  bool          `json:"adaptive_rate_limit"`
	BackoffMultiplier  float64       `json:"backoff_multiplier"`
	MaxBackoffDuration time.Duration `json:"max_backoff_duration"`

	// Paths
	DownloadPath string `json:"download_path"`
	DatabasePath string `json:"database_path"`

	// Quality settings
	PreferredQuality string `json:"preferred_quality"` // "hd" or "sd"

	// File organization settings
	CreateUserFolders bool `json:"create_user_folders"`
	OverwriteExisting bool `json:"overwrite_existing"`
	ShowProgress      bool `json:"show_progress"`

	// UI settings
	DarkMode          bool `json:"dark_mode"`
	ShowNotifications bool `json:"show_notifications"`
}

// NewConfig creates a new configuration with defaults
func NewConfig() *Config {
	return &Config{
		MaxConcurrentDownloads: 5,
		DownloadTimeout:        60 * time.Second,
		RetryAttempts:          3,
		RetryDelay:             2 * time.Second,
		APITimeout:             30 * time.Second,
		PageSize:               100,
		SearchOrders:           []string{"trending", "top", "recent", "best", "new"},
		RateLimitRequests:      10,
		RateLimitPeriod:        1 * time.Second,
		RateLimitBurst:         20,
		AdaptiveRateLimit:      true,
		BackoffMultiplier:      2.0,
		MaxBackoffDuration:     5 * time.Minute,
		DownloadPath:           "./downloads",
		DatabasePath:           "./redgifs.db",
		PreferredQuality:       "hd",
		DarkMode:               true,
		ShowNotifications:      true,
	}
}

// UserProfile represents a user's profile information
type UserProfile struct {
	Username   string `json:"username"`
	Name       string `json:"name"`
	ProfileURL string `json:"profile_url"`
	ProfilePic string `json:"profile_pic"`
	Followers  int    `json:"followers"`
	Following  int    `json:"following"`
	TotalGifs  int    `json:"total_gifs"`
	Views      int    `json:"views"`
	Likes      int    `json:"likes"`
}

// UserResult represents a user search result
type UserResult struct {
	Username        string `json:"username"`
	Name            string `json:"name"`
	ProfileImageURL string `json:"profileImageUrl"`
	ProfileURL      string `json:"profileUrl"`
	Followers       int    `json:"followers"`
	Gifs            int    `json:"gifs"`
	Views           int    `json:"views"`
	Verified        bool   `json:"verified"`
}

// Collection represents a user collection
type Collection struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	ContentCount int       `json:"content_count"`
	Thumbnail    string    `json:"thumbnail"`
	ThumbnailURL string    `json:"thumbnail_url"`
	CreatedAt    time.Time `json:"created_at"`
	Published    bool      `json:"published"`
}

// Content represents a single piece of content (gif/video)
type Content struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Duration    float64     `json:"duration"`
	Width       int         `json:"width"`
	Height      int         `json:"height"`
	Views       int         `json:"views"`
	Likes       int         `json:"likes"`
	Username    string      `json:"username"`
	CreateDate  int64       `json:"createDate"`
	HasAudio    bool        `json:"hasAudio"`
	URLs        ContentURLs `json:"urls"`
	Tags        []string    `json:"tags"`
	Niches      []string    `json:"niches"`
}

// ContentResponse represents a paginated content response
type ContentResponse struct {
	Contents []*Content `json:"contents"`
	Page     int        `json:"page"`
	Pages    int        `json:"pages"`
	Total    int        `json:"total"`
	NextPage *int       `json:"next_page,omitempty"`
}

// DownloadRequest represents a download request
type DownloadRequest struct {
	Type         string   `json:"type"` // "user", "collection", "likes", "single"
	Username     string   `json:"username,omitempty"`
	CollectionID string   `json:"collection_id,omitempty"`
	ContentIDs   []string `json:"content_ids,omitempty"`
	SearchOrders []string `json:"search_orders,omitempty"`
	Quality      string   `json:"quality,omitempty"`
	TargetPath   string   `json:"target_path,omitempty"`
}

// DownloadTask represents an active download task
type DownloadTask struct {
	ID           string                 `json:"id"`
	Type         string                 `json:"type"`
	Username     string                 `json:"username"`
	Status       string                 `json:"status"` // "queued", "downloading", "paused", "completed", "failed"
	Progress     float64                `json:"progress"`
	TotalItems   int                    `json:"total_items"`
	Downloaded   int                    `json:"downloaded"`
	Failed       int                    `json:"failed"`
	Skipped      int                    `json:"skipped"`
	StartTime    time.Time              `json:"start_time"`
	EndTime      *time.Time             `json:"end_time,omitempty"`
	UpdatedAt    time.Time              `json:"updated_at"`
	Error        string                 `json:"error,omitempty"`
	CurrentItem  string                 `json:"current_item,omitempty"`
	DownloadPath string                 `json:"download_path"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`

	// Internal fields for task management
	ctx    context.Context    `json:"-"`
	cancel context.CancelFunc `json:"-"`
}

// DownloadRecord represents a completed download in the database
type DownloadRecord struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	ContentID    string    `json:"content_id"`
	ContentName  string    `json:"content_name"`
	FilePath     string    `json:"file_path"`
	FileSize     int64     `json:"file_size"`
	Duration     float64   `json:"duration"`
	Width        int       `json:"width"`
	Height       int       `json:"height"`
	HasAudio     bool      `json:"has_audio"`
	DownloadedAt time.Time `json:"downloaded_at"`
	Thumbnail    string    `json:"thumbnail"`
	SearchOrder  string    `json:"search_order"`
	Rank         int       `json:"rank"`
}

// Settings represents user settings
type Settings struct {
	DownloadPath           string   `json:"download_path"`
	MaxConcurrentDownloads int      `json:"max_concurrent_downloads"`
	PreferredQuality       string   `json:"preferred_quality"`
	SearchOrders           []string `json:"search_orders"`
	CreateUserFolders      bool     `json:"create_user_folders"`
	OverwriteExisting      bool     `json:"overwrite_existing"`
	DarkMode               bool     `json:"dark_mode"`
	ShowNotifications      bool     `json:"show_notifications"`
	AutoRetryFailed        bool     `json:"auto_retry_failed"`
	ProxyURL               string   `json:"proxy_url,omitempty"`
}

// Statistics represents download statistics
type Statistics struct {
	TotalDownloads   int64        `json:"total_downloads"`
	TotalSize        int64        `json:"total_size"`
	TotalUsers       int          `json:"total_users"`
	TotalCollections int          `json:"total_collections"`
	DownloadsByDay   []DayStat    `json:"downloads_by_day"`
	TopUsers         []UserStat   `json:"top_users"`
	RecentDownloads  []RecentStat `json:"recent_downloads"`
}

type DayStat struct {
	Date      string `json:"date"`
	Downloads int    `json:"downloads"`
	Size      int64  `json:"size"`
}

type UserStat struct {
	Username  string `json:"username"`
	Downloads int    `json:"downloads"`
	Size      int64  `json:"size"`
}

type RecentStat struct {
	ContentName  string    `json:"content_name"`
	Username     string    `json:"username"`
	DownloadedAt time.Time `json:"downloaded_at"`
	Thumbnail    string    `json:"thumbnail"`
}

// API Response Types
type APITokenResponse struct {
	Token     string `json:"token"`
	ExpiresIn int    `json:"expires_in"`
}

type APIErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details string `json:"details,omitempty"`
		Delay   int    `json:"delay,omitempty"`
	} `json:"error"`
}

type APIUserResponse struct {
	Username        string `json:"username"`
	Name            string `json:"name"`
	ProfileImageURL string `json:"profileImageUrl"`
	ProfileURL      string `json:"profileUrl"`
	Followers       int    `json:"followers"`
	Following       int    `json:"following"`
	Gifs            int    `json:"gifs"`
	Views           int    `json:"views"`
	Likes           int    `json:"likes"`
	Verified        bool   `json:"verified"`
	CreationTime    int64  `json:"creationtime"`
}

type APIGifResponse struct {
	ID          string            `json:"id"`
	CreateDate  int64             `json:"createDate"`
	HasAudio    bool              `json:"hasAudio"`
	Width       int               `json:"width"`
	Height      int               `json:"height"`
	Likes       int               `json:"likes"`
	Views       int               `json:"views"`
	Duration    float64           `json:"duration"`
	Published   bool              `json:"published"`
	URLs        map[string]string `json:"urls"`
	UserName    string            `json:"userName"`
	Type        int               `json:"type"`
	AvgColor    string            `json:"avgColor"`
	Gallery     *string           `json:"gallery"`
	Description string            `json:"description"`
	Tags        []string          `json:"tags"`
	Niches      []string          `json:"niches"`
}

type APIContentResponse struct {
	Gifs  []APIGifResponse `json:"gifs"`
	Page  int              `json:"page"`
	Pages int              `json:"pages"`
	Total int              `json:"total"`
}

type APICollectionResponse struct {
	Collections []struct {
		FolderID     string `json:"folderId"`
		FolderName   string `json:"folderName"`
		Description  string `json:"description"`
		ContentCount int    `json:"contentCount"`
		CreateDate   int64  `json:"createDate"`
		Published    bool   `json:"published"`
		Thumb        string `json:"thumb"`
		ThumbA       string `json:"thumba"`
		ThumbS       string `json:"thumbs"`
		UserID       string `json:"userId"`
	} `json:"collections"`
	Page       int `json:"page"`
	Pages      int `json:"pages"`
	TotalCount int `json:"totalCount"`
}

// CircuitBreaker represents a circuit breaker for API health monitoring
type CircuitBreaker struct {
	State           string    `json:"state"` // "closed", "open", "half-open"
	FailureCount    int       `json:"failure_count"`
	LastFailureTime time.Time `json:"last_failure_time"`
	NextRetryTime   time.Time `json:"next_retry_time"`
}

// CacheEntry represents a cached API response
type CacheEntry struct {
	Data      interface{} `json:"data"`
	ExpiresAt time.Time   `json:"expires_at"`
	CreatedAt time.Time   `json:"created_at"`
}

// ContentURLs represents the URLs for different quality versions of content
type ContentURLs struct {
	HD         string `json:"hd"`
	SD         string `json:"sd"`
	Thumbnail  string `json:"thumbnail"`
	Poster     string `json:"poster"`
	Timeline   string `json:"timeline,omitempty"`
	VThumbnail string `json:"vthumbnail,omitempty"`
}

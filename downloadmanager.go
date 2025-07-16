package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// Downloader manages download operations
type Downloader struct {
	config      *Config
	api         *RedGifsAPI
	db          *DatabaseManager
	client      *http.Client
	rateLimiter *RateLimiter

	// Task management
	tasks      map[string]*DownloadTask
	tasksMutex sync.RWMutex

	// Worker pool
	workerPool  chan struct{}
	workerGroup sync.WaitGroup

	// Callbacks
	OnProgress func(taskID string, progress float64, current string)
	OnComplete func(taskID string)
	OnError    func(taskID string, err error)

	// Shutdown
	shutdownCh chan struct{}
	shutdown   atomic.Bool
}

// NewDownloader creates a new downloader
func NewDownloader(config *Config, api *RedGifsAPI, db *DatabaseManager) *Downloader {
	client := &http.Client{
		Timeout: config.DownloadTimeout,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	d := &Downloader{
		config:      config,
		api:         api,
		db:          db,
		client:      client,
		rateLimiter: NewRateLimiter(config),
		tasks:       make(map[string]*DownloadTask),
		workerPool:  make(chan struct{}, config.MaxConcurrentDownloads),
		shutdownCh:  make(chan struct{}),
	}

	// Initialize worker pool
	for i := 0; i < config.MaxConcurrentDownloads; i++ {
		d.workerPool <- struct{}{}
	}

	return d
}

// StartDownload starts a new download task
func (d *Downloader) StartDownload(request *DownloadRequest) (*DownloadTask, error) {
	if d.shutdown.Load() {
		return nil, fmt.Errorf("downloader is shutting down")
	}

	// Create task
	task := &DownloadTask{
		ID:           uuid.New().String(),
		Type:         request.Type,
		Username:     request.Username,
		Status:       "queued",
		Progress:     0,
		StartTime:    time.Now(),
		DownloadPath: d.buildDownloadPath(request),
		Metadata:     make(map[string]interface{}),
	}

	// Store request details in metadata
	task.Metadata["request"] = request

	// Add task to map
	d.tasksMutex.Lock()
	d.tasks[task.ID] = task
	d.tasksMutex.Unlock()

	// Start download in background
	d.workerGroup.Add(1)
	go d.processTask(task)

	return task, nil
}

// processTask processes a download task
func (d *Downloader) processTask(task *DownloadTask) {
	defer d.workerGroup.Done()

	// Update status
	d.updateTaskStatus(task, "downloading")

	// Execute based on type
	var err error
	switch task.Type {
	case "user":
		err = d.downloadUserContent(task)
	case "collection":
		err = d.downloadCollection(task)
	case "likes":
		err = d.downloadLikes(task)
	case "single":
		err = d.downloadSingle(task)
	default:
		err = fmt.Errorf("unknown download type: %s", task.Type)
	}

	// Update final status
	if err != nil {
		d.updateTaskStatus(task, "failed")
		task.Error = err.Error()
		if d.OnError != nil {
			d.OnError(task.ID, err)
		}
	} else {
		d.updateTaskStatus(task, "completed")
		endTime := time.Now()
		task.EndTime = &endTime
		if d.OnComplete != nil {
			d.OnComplete(task.ID)
		}
	}
}

// downloadUserContent downloads all content for a user
func (d *Downloader) downloadUserContent(task *DownloadTask) error {
	request := task.Metadata["request"].(*DownloadRequest)

	// Get existing downloads
	existing, err := d.db.GetUserDownloads(request.Username, 10000) // Large limit to get all
	if err != nil {
		return fmt.Errorf("failed to get existing downloads: %w", err)
	}

	existingMap := make(map[string]bool)
	for _, record := range existing {
		existingMap[record.ContentID] = true
	}

	// Collect all content across search orders
	allContent := make([]*Content, 0)
	contentMap := make(map[string]*Content)

	searchOrders := request.SearchOrders
	if len(searchOrders) == 0 {
		searchOrders = d.config.SearchOrders
	}

	for _, order := range searchOrders {
		page := 1
		for {
			// Check shutdown
			if d.shutdown.Load() {
				return fmt.Errorf("download cancelled: shutting down")
			}

			// Get page of content
			resp, err := d.api.GetUserContent(request.Username, order, page)
			if err != nil {
				return fmt.Errorf("failed to get content (order=%s, page=%d): %w", order, page, err)
			}

			// Add unique content
			for _, content := range resp.Contents {
				if _, exists := contentMap[content.ID]; !exists {
					contentMap[content.ID] = content
					allContent = append(allContent, content)
				}
			}

			// Check if more pages
			if resp.NextPage == nil || page >= resp.Pages {
				break
			}
			page++
		}
	}

	// Update task totals
	task.TotalItems = len(allContent)

	// Download each item
	for i, content := range allContent {
		// Check if already downloaded
		if existingMap[content.ID] {
			task.Skipped++
			continue
		}

		// Update progress
		task.CurrentItem = content.ID
		task.Progress = float64(i) / float64(len(allContent)) * 100
		if d.OnProgress != nil {
			d.OnProgress(task.ID, task.Progress, content.ID)
		}

		// Download content
		if err := d.downloadContent(task, content, i+1); err != nil {
			task.Failed++
			// Continue with next item
		} else {
			task.Downloaded++
		}
	}

	return nil
}

// downloadCollection downloads a collection
func (d *Downloader) downloadCollection(task *DownloadTask) error {
	request := task.Metadata["request"].(*DownloadRequest)

	// Get all content from collection
	allContent := make([]*Content, 0)
	page := 1

	for {
		resp, err := d.api.doRequest(
			context.Background(),
			"GET",
			fmt.Sprintf("/me/collections/%s/gifs", request.CollectionID),
			url.Values{
				"count": {fmt.Sprintf("%d", d.config.PageSize)},
				"page":  {fmt.Sprintf("%d", page)},
			},
			nil,
			true,
		)
		if err != nil {
			return fmt.Errorf("failed to get collection content: %w", err)
		}

		var apiResp APIContentResponse
		if err := json.Unmarshal(resp, &apiResp); err != nil {
			return fmt.Errorf("failed to parse collection content: %w", err)
		}

		contentResp := d.api.convertContentResponse(&apiResp)
		allContent = append(allContent, contentResp.Contents...)

		if contentResp.NextPage == nil {
			break
		}
		page++
	}

	// Update task totals
	task.TotalItems = len(allContent)

	// Download each item
	for i, content := range allContent {
		task.CurrentItem = content.ID
		task.Progress = float64(i) / float64(len(allContent)) * 100
		if d.OnProgress != nil {
			d.OnProgress(task.ID, task.Progress, content.ID)
		}

		if err := d.downloadContent(task, content, i+1); err != nil {
			task.Failed++
		} else {
			task.Downloaded++
		}
	}

	return nil
}

// downloadLikes downloads liked content
func (d *Downloader) downloadLikes(task *DownloadTask) error {
	// Similar to downloadCollection but uses likes endpoint
	allContent := make([]*Content, 0)
	page := 1

	for {
		resp, err := d.api.GetLikedContent(page)
		if err != nil {
			return fmt.Errorf("failed to get liked content: %w", err)
		}

		allContent = append(allContent, resp.Contents...)

		if resp.NextPage == nil {
			break
		}
		page++
	}

	task.TotalItems = len(allContent)

	for i, content := range allContent {
		task.CurrentItem = content.ID
		task.Progress = float64(i) / float64(len(allContent)) * 100
		if d.OnProgress != nil {
			d.OnProgress(task.ID, task.Progress, content.ID)
		}

		if err := d.downloadContent(task, content, i+1); err != nil {
			task.Failed++
		} else {
			task.Downloaded++
		}
	}

	return nil
}

// downloadSingle downloads specific content items
func (d *Downloader) downloadSingle(task *DownloadTask) error {
	request := task.Metadata["request"].(*DownloadRequest)
	task.TotalItems = len(request.ContentIDs)

	for i, contentID := range request.ContentIDs {
		// Get content details
		// Note: This would require an API endpoint to get single content
		// For now, we'll skip this implementation
		task.Progress = float64(i) / float64(len(request.ContentIDs)) * 100
		if d.OnProgress != nil {
			d.OnProgress(task.ID, task.Progress, contentID)
		}
	}

	return nil
}

// downloadContent downloads a single content item
func (d *Downloader) downloadContent(task *DownloadTask, content *Content, rank int) error {
	// Acquire worker slot
	select {
	case <-d.workerPool:
		defer func() { d.workerPool <- struct{}{} }()
	case <-d.shutdownCh:
		return fmt.Errorf("download cancelled: shutting down")
	}

	// Rate limiting
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := d.rateLimiter.Wait(ctx); err != nil {
		return fmt.Errorf("rate limit error: %w", err)
	}

	// Determine quality
	request := task.Metadata["request"].(*DownloadRequest)
	quality := request.Quality
	if quality == "" {
		quality = d.config.PreferredQuality
	}

	// Get download URL
	downloadURL := ""
	switch quality {
	case "hd":
		if content.URLs.HD != "" {
			downloadURL = content.URLs.HD
		} else if content.URLs.SD != "" {
			downloadURL = content.URLs.SD
		}
	case "sd":
		if content.URLs.SD != "" {
			downloadURL = content.URLs.SD
		} else if content.URLs.HD != "" {
			downloadURL = content.URLs.HD
		}
	default:
		if content.URLs.HD != "" {
			downloadURL = content.URLs.HD
		} else if content.URLs.SD != "" {
			downloadURL = content.URLs.SD
		}
	}

	if downloadURL == "" {
		return fmt.Errorf("no download URL available")
	}

	// Build filename
	filename := d.buildFilename(content, rank)
	filepath := filepath.Join(task.DownloadPath, filename)

	// Check if file exists
	if _, err := os.Stat(filepath); err == nil {
		// File exists, check if we should overwrite
		settings, _ := d.db.GetSettings()
		if settings != nil && !settings.OverwriteExisting {
			return nil // Skip
		}
	}

	// Create directory
	if err := os.MkdirAll(task.DownloadPath, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Download file
	startTime := time.Now()
	size, err := d.downloadFile(ctx, downloadURL, filepath)
	if err != nil {
		d.rateLimiter.RecordFailure(0, 0)
		return fmt.Errorf("download failed: %w", err)
	}

	responseTime := time.Since(startTime)
	d.rateLimiter.RecordSuccess(responseTime)

	// Record in database
	record := &DownloadRecord{
		Username:     task.Username,
		ContentID:    content.ID,
		ContentName:  filename,
		FilePath:     filepath,
		FileSize:     size,
		Duration:     content.Duration,
		Width:        content.Width,
		Height:       content.Height,
		HasAudio:     content.HasAudio,
		DownloadedAt: time.Now(),
		Thumbnail:    content.URLs.Thumbnail,
		SearchOrder:  request.SearchOrders[0], // Primary search order
		Rank:         rank,
	}

	if err := d.db.RecordDownload(record); err != nil {
		// Log error but don't fail the download
		fmt.Printf("Failed to record download: %v\n", err)
	}

	return nil
}

// downloadFile downloads a file from URL to path
func (d *Downloader) downloadFile(ctx context.Context, url, filepath string) (int64, error) {
	// Create temporary file
	tempFile := filepath + ".tmp"

	out, err := os.Create(tempFile)
	if err != nil {
		return 0, fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		os.Remove(tempFile)
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "RedGifs-Downloader/2.0")

	// Download with retries
	var size int64
	for attempt := 0; attempt <= d.config.RetryAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(d.config.RetryDelay * time.Duration(attempt))
		}

		resp, err := d.client.Do(req)
		if err != nil {
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			continue
		}

		// Copy data
		size, err = io.Copy(out, resp.Body)
		if err == nil {
			break
		}
	}

	if err != nil {
		os.Remove(tempFile)
		return 0, err
	}

	// Close file before rename
	out.Close()

	// Rename to final name
	if err := os.Rename(tempFile, filepath); err != nil {
		os.Remove(tempFile)
		return 0, fmt.Errorf("failed to rename file: %w", err)
	}

	return size, nil
}

// Helper methods

func (d *Downloader) buildDownloadPath(request *DownloadRequest) string {
	if request.TargetPath != "" {
		return request.TargetPath
	}

	settings, _ := d.db.GetSettings()
	basePath := d.config.DownloadPath
	if settings != nil && settings.DownloadPath != "" {
		basePath = settings.DownloadPath
	}

	switch request.Type {
	case "user":
		if settings != nil && settings.CreateUserFolders {
			return filepath.Join(basePath, "users", request.Username)
		}
		return filepath.Join(basePath, request.Username)

	case "collection":
		return filepath.Join(basePath, "collections", request.CollectionID)

	case "likes":
		return filepath.Join(basePath, "likes")

	default:
		return basePath
	}
}

func (d *Downloader) buildFilename(content *Content, rank int) string {
	// Format: [rank]_[id]_[username].[ext]
	ext := "mp4"
	if content.URLs.HD != "" {
		parts := strings.Split(content.URLs.HD, ".")
		if len(parts) > 1 {
			ext = parts[len(parts)-1]
		}
	}

	// Clean filename
	filename := fmt.Sprintf("%04d_%s_%s.%s", rank, content.ID, content.Username, ext)

	// Remove invalid characters
	filename = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' {
			return '_'
		}
		return r
	}, filename)

	return filename
}

func (d *Downloader) updateTaskStatus(task *DownloadTask, status string) {
	d.tasksMutex.Lock()
	task.Status = status
	d.tasksMutex.Unlock()
}

// Task management methods

func (d *Downloader) GetAllTasks() ([]*DownloadTask, error) {
	d.tasksMutex.RLock()
	defer d.tasksMutex.RUnlock()

	tasks := make([]*DownloadTask, 0, len(d.tasks))
	for _, task := range d.tasks {
		tasks = append(tasks, task)
	}

	return tasks, nil
}

func (d *Downloader) GetTask(taskID string) (*DownloadTask, error) {
	d.tasksMutex.RLock()
	defer d.tasksMutex.RUnlock()

	task, ok := d.tasks[taskID]
	if !ok {
		return nil, fmt.Errorf("task not found")
	}

	return task, nil
}

func (d *Downloader) PauseTask(taskID string) error {
	d.tasksMutex.Lock()
	defer d.tasksMutex.Unlock()

	task, exists := d.tasks[taskID]
	if !exists {
		return fmt.Errorf("task not found: %s", taskID)
	}

	if task.Status != "running" {
		return fmt.Errorf("task is not running")
	}

	task.Status = "paused"
	task.UpdatedAt = time.Now()

	// Cancel the task context to stop downloads
	if task.cancel != nil {
		task.cancel()
	}

	return nil
}

func (d *Downloader) ResumeTask(taskID string) error {
	d.tasksMutex.Lock()
	defer d.tasksMutex.Unlock()

	task, exists := d.tasks[taskID]
	if !exists {
		return fmt.Errorf("task not found: %s", taskID)
	}

	if task.Status != "paused" {
		return fmt.Errorf("task is not paused")
	}

	task.Status = "running"
	task.UpdatedAt = time.Now()

	// Create new context for resumed task
	ctx, cancel := context.WithCancel(context.Background())
	task.ctx = ctx
	task.cancel = cancel

	// Resume downloads
	go d.processTask(task)

	return nil
}

func (d *Downloader) CancelTask(taskID string) error {
	d.tasksMutex.Lock()
	defer d.tasksMutex.Unlock()

	task, exists := d.tasks[taskID]
	if !exists {
		return fmt.Errorf("task not found: %s", taskID)
	}

	task.Status = "cancelled"
	task.UpdatedAt = time.Now()
	task.EndTime = &task.UpdatedAt

	// Cancel the task context
	if task.cancel != nil {
		task.cancel()
	}

	return nil
}

func (d *Downloader) Shutdown() {
	d.shutdown.Store(true)
	close(d.shutdownCh)
	d.workerGroup.Wait()
}

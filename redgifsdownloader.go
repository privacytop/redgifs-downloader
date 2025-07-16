package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// App struct
type App struct {
	ctx         context.Context
	downloader  *Downloader
	api         *RedGifsAPI
	db          *DatabaseManager
	authManager *AuthManager
	collections *CollectionManager
	uiEvents    *UIEventManager
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Initialize components with default configuration
	config := &Config{
		MaxConcurrentDownloads: 5,
		DownloadTimeout:        60 * time.Second,
		RetryAttempts:          3,
		RetryDelay:             2 * time.Second,
		APITimeout:             30 * time.Second,
		PageSize:               100,
		SearchOrders:           []string{"trending", "top", "recent", "best", "new"},
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
		DatabasePath:           "./redgifs.db",
		PreferredQuality:       "hd",
		CreateUserFolders:      true,
		OverwriteExisting:      false,
		ShowProgress:           true,
	}
	a.db = NewDatabaseManager("redgifs.db")
	if err := a.db.Initialize(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	a.api = NewRedGifsAPI(config)
	a.authManager = NewAuthManager(ctx, a.api, a.db)
	a.downloader = NewDownloader(config, a.api, a.db)
	a.collections = NewCollectionManager(a.api, a.db)
	a.uiEvents = NewUIEventManager(ctx)

	// Set up event listeners
	a.downloader.OnProgress = a.uiEvents.SendDownloadProgress
	a.downloader.OnComplete = a.uiEvents.SendDownloadComplete
	a.downloader.OnError = a.uiEvents.SendDownloadError

	// Restore session if available
	if token, err := a.db.GetStoredToken(); err == nil && token != "" {
		a.api.SetToken(token)
		a.uiEvents.SendAuthStatus(true)
	}
}

// GetUserProfile returns the current user's profile
func (a *App) GetUserProfile() (*UserProfile, error) {
	if !a.api.IsAuthenticated() {
		return nil, fmt.Errorf("not authenticated")
	}

	profile, err := a.api.GetUserProfile()
	if err != nil {
		return nil, err
	}

	return &UserProfile{
		Username:   profile.Username,
		Name:       profile.Name,
		ProfileURL: profile.ProfileURL,
		ProfilePic: profile.ProfileImageURL,
		Followers:  profile.Followers,
		Following:  profile.Following,
		TotalGifs:  profile.Gifs,
		Views:      profile.Views,
		Likes:      profile.Likes,
	}, nil
}

// Login initiates the browser-based login flow
func (a *App) Login() error {
	return a.authManager.Login(a.ctx)
}

// Logout logs out the current user
func (a *App) Logout() error {
	a.api.ClearToken()
	a.db.ClearStoredToken()
	a.uiEvents.SendAuthStatus(false)
	return nil
}

// SearchUsers searches for users by query
func (a *App) SearchUsers(query string) ([]*UserResult, error) {
	return a.api.SearchUsers(query)
}

// GetUserContent gets all content for a user
func (a *App) GetUserContent(username string, searchOrder string, page int) (*ContentResponse, error) {
	return a.api.GetUserContent(username, searchOrder, page)
}

// GetUserCollections gets collections for a user
func (a *App) GetUserCollections(username string) ([]*Collection, error) {
	if !a.api.IsAuthenticated() {
		return nil, fmt.Errorf("authentication required for collections")
	}
	return a.collections.GetUserCollections(username)
}

// GetCollectionContent gets content of a specific collection
func (a *App) GetCollectionContent(collectionID string, page int) (*ContentResponse, error) {
	if !a.api.IsAuthenticated() {
		return nil, fmt.Errorf("authentication required for collections")
	}
	return a.collections.GetCollectionContent(collectionID, page)
}

// GetLikedContent gets the user's liked content
func (a *App) GetLikedContent(page int) (*ContentResponse, error) {
	if !a.api.IsAuthenticated() {
		return nil, fmt.Errorf("authentication required for likes")
	}
	return a.api.GetLikedContent(page)
}

// DownloadContent starts downloading content
func (a *App) DownloadContent(request *DownloadRequest) (*DownloadTask, error) {
	return a.downloader.StartDownload(request)
}

// GetDownloadTasks returns all download tasks
func (a *App) GetDownloadTasks() ([]*DownloadTask, error) {
	return a.downloader.GetAllTasks()
}

// GetDownloadHistory returns download history
func (a *App) GetDownloadHistory(username string, limit int) ([]*DownloadRecord, error) {
	return a.db.GetDownloadHistory(username, limit)
}

// PauseDownload pauses a download task
func (a *App) PauseDownload(taskID string) error {
	return a.downloader.PauseTask(taskID)
}

// ResumeDownload resumes a download task
func (a *App) ResumeDownload(taskID string) error {
	return a.downloader.ResumeTask(taskID)
}

// CancelDownload cancels a download task
func (a *App) CancelDownload(taskID string) error {
	return a.downloader.CancelTask(taskID)
}

// GetSettings returns current application settings
func (a *App) GetSettings() (*Settings, error) {
	settings, err := a.db.GetSettings()
	if err != nil {
		a.uiEvents.SendError("Settings Error", "Failed to load settings")
		return nil, fmt.Errorf("failed to get settings: %w", err)
	}
	return settings, nil
}

// UpdateSettings updates application settings
func (a *App) UpdateSettings(settings *Settings) error {
	if err := a.db.UpdateSettings(settings); err != nil {
		a.uiEvents.SendError("Settings Error", "Failed to save settings")
		return fmt.Errorf("failed to update settings: %w", err)
	}

	a.uiEvents.SendSuccess("Settings Saved", "Your settings have been updated successfully")
	return nil
}

// GetStatistics returns download statistics
func (a *App) GetStatistics() (*Statistics, error) {
	stats, err := a.db.GetStatistics()
	if err != nil {
		a.uiEvents.SendError("Statistics Error", "Failed to load statistics")
		return nil, fmt.Errorf("failed to get statistics: %w", err)
	}
	return stats, nil
}

// OpenFolder opens a folder in the system file explorer
func (a *App) OpenFolder(path string) error {
	return OpenInExplorer(path)
}

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	a.downloader.Shutdown()
	a.db.Close()
}

func main() {
	// Create application with options
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "RedGifs Downloader",
		Width:  1400,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				FullSizeContent:            true,
			},
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title:   "RedGifs Downloader",
				Message: "A beautiful and powerful RedGifs content downloader",
			},
		},
		Linux: &linux.Options{
			Icon: []byte{}, // Add icon bytes here
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

// Handle graceful shutdown
func init() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		os.Exit(0)
	}()
}

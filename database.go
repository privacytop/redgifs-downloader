package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	_ "modernc.org/sqlite"
)

// DatabaseManager handles all database operations
type DatabaseManager struct {
	db   *sql.DB
	path string
}

// NewDatabaseManager creates a new database manager
func NewDatabaseManager(path string) *DatabaseManager {
	return &DatabaseManager{
		path: path,
	}
}

// Initialize initializes the database and creates tables
func (dm *DatabaseManager) Initialize() error {
	var err error
	dm.db, err = sql.Open("sqlite", dm.path)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Enable foreign keys and WAL mode for better performance
	if _, err := dm.db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	if _, err := dm.db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		return fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	// Run migrations
	if err := dm.runMigrations(); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	return nil
}

// runMigrations runs database migrations
func (dm *DatabaseManager) runMigrations() error {
	// Create migrations table if it doesn't exist
	_, err := dm.db.Exec(`
		CREATE TABLE IF NOT EXISTS migrations (
			version INTEGER PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Get current version
	var currentVersion int
	err = dm.db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM migrations").Scan(&currentVersion)
	if err != nil {
		return fmt.Errorf("failed to get current migration version: %w", err)
	}

	// Define migrations
	migrations := []migration{
		{version: 1, description: "Initial schema", up: dm.createTables},
		// Add more migrations here as needed
	}

	// Apply pending migrations
	for _, m := range migrations {
		if m.version > currentVersion {
			log.Printf("Applying migration %d: %s", m.version, m.description)
			if err := m.up(); err != nil {
				return fmt.Errorf("failed to apply migration %d: %w", m.version, err)
			}

			// Record migration
			_, err := dm.db.Exec("INSERT INTO migrations (version) VALUES (?)", m.version)
			if err != nil {
				return fmt.Errorf("failed to record migration %d: %w", m.version, err)
			}
		}
	}

	return nil
}

type migration struct {
	version     int
	description string
	up          func() error
}

// createTables creates all necessary database tables
func (dm *DatabaseManager) createTables() error {
	queries := []string{
		// Users table
		`CREATE TABLE IF NOT EXISTS users (
			username TEXT PRIMARY KEY,
			name TEXT,
			profile_url TEXT,
			profile_image_url TEXT,
			followers INTEGER DEFAULT 0,
			following INTEGER DEFAULT 0,
			gifs INTEGER DEFAULT 0,
			views INTEGER DEFAULT 0,
			likes INTEGER DEFAULT 0,
			verified BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,

		// Collections table
		`CREATE TABLE IF NOT EXISTS collections (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			content_count INTEGER DEFAULT 0,
			thumbnail TEXT,
			thumbnail_url TEXT,
			published BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (username) REFERENCES users(username)
		)`,

		// Content table
		`CREATE TABLE IF NOT EXISTS content (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			title TEXT,
			description TEXT,
			duration REAL DEFAULT 0,
			width INTEGER DEFAULT 0,
			height INTEGER DEFAULT 0,
			views INTEGER DEFAULT 0,
			likes INTEGER DEFAULT 0,
			create_date INTEGER,
			has_audio BOOLEAN DEFAULT FALSE,
			urls TEXT, -- JSON
			tags TEXT, -- JSON
			niches TEXT, -- JSON
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (username) REFERENCES users(username)
		)`,

		// Downloads table
		`CREATE TABLE IF NOT EXISTS downloads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			content_id TEXT NOT NULL,
			content_name TEXT NOT NULL,
			file_path TEXT NOT NULL,
			file_size INTEGER DEFAULT 0,
			duration REAL DEFAULT 0,
			width INTEGER DEFAULT 0,
			height INTEGER DEFAULT 0,
			has_audio BOOLEAN DEFAULT FALSE,
			thumbnail TEXT,
			search_order TEXT,
			rank INTEGER DEFAULT 0,
			downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(username, content_id),
			FOREIGN KEY (username) REFERENCES users(username),
			FOREIGN KEY (content_id) REFERENCES content(id)
		)`,

		// Download tasks table
		`CREATE TABLE IF NOT EXISTS download_tasks (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			username TEXT,
			status TEXT NOT NULL,
			progress REAL DEFAULT 0,
			total_items INTEGER DEFAULT 0,
			downloaded INTEGER DEFAULT 0,
			failed INTEGER DEFAULT 0,
			skipped INTEGER DEFAULT 0,
			start_time TIMESTAMP,
			end_time TIMESTAMP,
			error TEXT,
			current_item TEXT,
			download_path TEXT,
			metadata TEXT, -- JSON
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,

		// Settings table
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,

		// Auth tokens table
		`CREATE TABLE IF NOT EXISTS auth_tokens (
			id INTEGER PRIMARY KEY,
			token TEXT NOT NULL,
			expires_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,

		// Failed downloads table
		`CREATE TABLE IF NOT EXISTS failed_downloads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			content_id TEXT NOT NULL,
			url TEXT NOT NULL,
			error_message TEXT,
			attempts INTEGER DEFAULT 1,
			last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(username, content_id)
		)`,
	}

	for _, query := range queries {
		if _, err := dm.db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query: %w", err)
		}
	}

	// Create indices for better performance
	indices := []string{
		"CREATE INDEX IF NOT EXISTS idx_downloads_username ON downloads(username)",
		"CREATE INDEX IF NOT EXISTS idx_downloads_downloaded_at ON downloads(downloaded_at)",
		"CREATE INDEX IF NOT EXISTS idx_content_username ON content(username)",
		"CREATE INDEX IF NOT EXISTS idx_content_create_date ON content(create_date)",
		"CREATE INDEX IF NOT EXISTS idx_collections_username ON collections(username)",
		"CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status)",
		"CREATE INDEX IF NOT EXISTS idx_failed_downloads_username ON failed_downloads(username)",
	}

	for _, index := range indices {
		if _, err := dm.db.Exec(index); err != nil {
			log.Printf("Warning: failed to create index: %v", err)
		}
	}

	return nil
}

// Close closes the database connection
func (dm *DatabaseManager) Close() error {
	if dm.db != nil {
		return dm.db.Close()
	}
	return nil
}

// StoreToken stores an authentication token
func (dm *DatabaseManager) StoreToken(token string) error {
	// Clear existing tokens first
	if _, err := dm.db.Exec("DELETE FROM auth_tokens"); err != nil {
		return fmt.Errorf("failed to clear existing tokens: %w", err)
	}

	// Store new token
	_, err := dm.db.Exec(
		"INSERT INTO auth_tokens (token, expires_at) VALUES (?, ?)",
		token, time.Now().Add(55*time.Minute),
	)
	if err != nil {
		return fmt.Errorf("failed to store token: %w", err)
	}

	return nil
}

// GetStoredToken retrieves the stored authentication token
func (dm *DatabaseManager) GetStoredToken() (string, error) {
	var token string
	var expiresAt time.Time

	err := dm.db.QueryRow(
		"SELECT token, expires_at FROM auth_tokens ORDER BY created_at DESC LIMIT 1",
	).Scan(&token, &expiresAt)

	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("failed to get token: %w", err)
	}

	// Check if token is expired
	if time.Now().After(expiresAt) {
		return "", nil
	}

	return token, nil
}

// ClearStoredToken clears the stored authentication token
func (dm *DatabaseManager) ClearStoredToken() error {
	_, err := dm.db.Exec("DELETE FROM auth_tokens")
	if err != nil {
		return fmt.Errorf("failed to clear token: %w", err)
	}
	return nil
}

// StoreCollections stores collections for a user
func (dm *DatabaseManager) StoreCollections(username string, collections []*Collection) error {
	tx, err := dm.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Clear existing collections for this user
	if _, err := tx.Exec("DELETE FROM collections WHERE username = ?", username); err != nil {
		return fmt.Errorf("failed to clear existing collections: %w", err)
	}

	// Insert new collections
	stmt, err := tx.Prepare(`
		INSERT INTO collections (id, username, name, description, content_count, 
			thumbnail, thumbnail_url, published, created_at) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, col := range collections {
		_, err := stmt.Exec(
			col.ID, username, col.Name, col.Description, col.ContentCount,
			col.Thumbnail, col.ThumbnailURL, col.Published, col.CreatedAt,
		)
		if err != nil {
			return fmt.Errorf("failed to insert collection: %w", err)
		}
	}

	return tx.Commit()
}

// GetCollection retrieves a collection by ID
func (dm *DatabaseManager) GetCollection(collectionID string) (*Collection, error) {
	var col Collection
	var createdAt, updatedAt time.Time

	err := dm.db.QueryRow(`
		SELECT id, username, name, description, content_count, thumbnail, 
			thumbnail_url, published, created_at, updated_at
		FROM collections WHERE id = ?
	`, collectionID).Scan(
		&col.ID, &col.Name, &col.Description, &col.ContentCount,
		&col.Thumbnail, &col.ThumbnailURL, &col.Published, &createdAt, &updatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("collection not found")
		}
		return nil, fmt.Errorf("failed to get collection: %w", err)
	}

	col.CreatedAt = createdAt
	return &col, nil
}

// GetRecentCollections retrieves recently accessed collections
func (dm *DatabaseManager) GetRecentCollections(limit int) ([]*Collection, error) {
	rows, err := dm.db.Query(`
		SELECT id, username, name, description, content_count, thumbnail, 
			thumbnail_url, published, created_at, updated_at
		FROM collections 
		ORDER BY updated_at DESC 
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query recent collections: %w", err)
	}
	defer rows.Close()

	var collections []*Collection
	for rows.Next() {
		var col Collection
		var createdAt, updatedAt time.Time

		err := rows.Scan(
			&col.ID, &col.Name, &col.Description, &col.ContentCount,
			&col.Thumbnail, &col.ThumbnailURL, &col.Published, &createdAt, &updatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan collection: %w", err)
		}

		col.CreatedAt = createdAt
		collections = append(collections, &col)
	}

	return collections, nil
}

// RecordDownload records a successful download
func (dm *DatabaseManager) RecordDownload(record *DownloadRecord) error {
	_, err := dm.db.Exec(`
		INSERT OR REPLACE INTO downloads
		(username, content_id, content_name, file_path, file_size, duration,
		 width, height, has_audio, thumbnail, search_order, rank)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, record.Username, record.ContentID, record.ContentName, record.FilePath,
		record.FileSize, record.Duration, record.Width, record.Height,
		record.HasAudio, record.Thumbnail, record.SearchOrder, record.Rank)

	if err != nil {
		return fmt.Errorf("failed to record download: %w", err)
	}
	return nil
}

// GetDownloadHistory retrieves download history for a user
func (dm *DatabaseManager) GetDownloadHistory(username string, limit int) ([]*DownloadRecord, error) {
	query := `
		SELECT id, username, content_id, content_name, file_path, file_size,
			duration, width, height, has_audio, thumbnail, search_order, rank, downloaded_at
		FROM downloads
		WHERE username = ?
		ORDER BY downloaded_at DESC
	`

	args := []interface{}{username}
	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
	}

	rows, err := dm.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query download history: %w", err)
	}
	defer rows.Close()

	var records []*DownloadRecord
	for rows.Next() {
		var record DownloadRecord
		err := rows.Scan(
			&record.ID, &record.Username, &record.ContentID, &record.ContentName,
			&record.FilePath, &record.FileSize, &record.Duration, &record.Width,
			&record.Height, &record.HasAudio, &record.Thumbnail, &record.SearchOrder,
			&record.Rank, &record.DownloadedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan download record: %w", err)
		}
		records = append(records, &record)
	}

	return records, nil
}

// GetSettings retrieves application settings
func (dm *DatabaseManager) GetSettings() (*Settings, error) {
	settings := &Settings{
		DownloadPath:           "./downloads",
		MaxConcurrentDownloads: 5,
		PreferredQuality:       "hd",
		SearchOrders:           []string{"trending", "top", "recent", "best", "new"},
		CreateUserFolders:      true,
		OverwriteExisting:      false,
		DarkMode:               true,
		ShowNotifications:      true,
		AutoRetryFailed:        true,
	}

	rows, err := dm.db.Query("SELECT key, value FROM settings")
	if err != nil {
		return settings, nil // Return defaults if no settings found
	}
	defer rows.Close()

	settingsMap := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		settingsMap[key] = value
	}

	// Apply stored settings
	if val, ok := settingsMap["download_path"]; ok {
		settings.DownloadPath = val
	}
	if val, ok := settingsMap["preferred_quality"]; ok {
		settings.PreferredQuality = val
	}
	if val, ok := settingsMap["search_orders"]; ok {
		var orders []string
		if err := json.Unmarshal([]byte(val), &orders); err == nil {
			settings.SearchOrders = orders
		}
	}
	// Add more setting mappings as needed...

	return settings, nil
}

// UpdateSettings updates application settings
func (dm *DatabaseManager) UpdateSettings(settings *Settings) error {
	tx, err := dm.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Prepare statement for upsert
	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO settings (key, value, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	// Store individual settings
	settingsMap := map[string]interface{}{
		"download_path":            settings.DownloadPath,
		"max_concurrent_downloads": settings.MaxConcurrentDownloads,
		"preferred_quality":        settings.PreferredQuality,
		"create_user_folders":      settings.CreateUserFolders,
		"overwrite_existing":       settings.OverwriteExisting,
		"dark_mode":                settings.DarkMode,
		"show_notifications":       settings.ShowNotifications,
		"auto_retry_failed":        settings.AutoRetryFailed,
		"proxy_url":                settings.ProxyURL,
	}

	// Handle JSON fields
	if searchOrdersJSON, err := json.Marshal(settings.SearchOrders); err == nil {
		settingsMap["search_orders"] = string(searchOrdersJSON)
	}

	for key, value := range settingsMap {
		var valueStr string
		switch v := value.(type) {
		case string:
			valueStr = v
		case bool:
			if v {
				valueStr = "true"
			} else {
				valueStr = "false"
			}
		case int:
			valueStr = fmt.Sprintf("%d", v)
		default:
			valueStr = fmt.Sprintf("%v", v)
		}

		if _, err := stmt.Exec(key, valueStr); err != nil {
			return fmt.Errorf("failed to update setting %s: %w", key, err)
		}
	}

	return tx.Commit()
}

// GetStatistics retrieves download statistics
func (dm *DatabaseManager) GetStatistics() (*Statistics, error) {
	stats := &Statistics{
		DownloadsByDay:  []DayStat{},
		TopUsers:        []UserStat{},
		RecentDownloads: []RecentStat{},
	}

	// Get total downloads and size
	err := dm.db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(file_size), 0)
		FROM downloads
	`).Scan(&stats.TotalDownloads, &stats.TotalSize)
	if err != nil {
		return nil, fmt.Errorf("failed to get total stats: %w", err)
	}

	// Get total users and collections
	dm.db.QueryRow("SELECT COUNT(DISTINCT username) FROM downloads").Scan(&stats.TotalUsers)
	dm.db.QueryRow("SELECT COUNT(*) FROM collections").Scan(&stats.TotalCollections)

	// Get downloads by day (last 30 days)
	rows, err := dm.db.Query(`
		SELECT DATE(downloaded_at) as date, COUNT(*), COALESCE(SUM(file_size), 0)
		FROM downloads
		WHERE downloaded_at >= DATE('now', '-30 days')
		GROUP BY DATE(downloaded_at)
		ORDER BY date DESC
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var stat DayStat
			rows.Scan(&stat.Date, &stat.Downloads, &stat.Size)
			stats.DownloadsByDay = append(stats.DownloadsByDay, stat)
		}
	}

	// Get top users
	rows, err = dm.db.Query(`
		SELECT username, COUNT(*), COALESCE(SUM(file_size), 0)
		FROM downloads
		GROUP BY username
		ORDER BY COUNT(*) DESC
		LIMIT 10
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var stat UserStat
			rows.Scan(&stat.Username, &stat.Downloads, &stat.Size)
			stats.TopUsers = append(stats.TopUsers, stat)
		}
	}

	// Get recent downloads
	rows, err = dm.db.Query(`
		SELECT content_name, username, downloaded_at, thumbnail
		FROM downloads
		ORDER BY downloaded_at DESC
		LIMIT 20
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var stat RecentStat
			rows.Scan(&stat.ContentName, &stat.Username, &stat.DownloadedAt, &stat.Thumbnail)
			stats.RecentDownloads = append(stats.RecentDownloads, stat)
		}
	}

	return stats, nil
}

// UpdateCollectionAccessTime updates the last accessed time for a collection
func (dm *DatabaseManager) UpdateCollectionAccessTime(collectionID string) error {
	_, err := dm.db.Exec(`
		UPDATE collections
		SET updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, collectionID)

	if err != nil {
		return fmt.Errorf("failed to update collection access time: %w", err)
	}

	return nil
}

// GetUserDownloads retrieves download records for a specific user
func (dm *DatabaseManager) GetUserDownloads(username string, limit int) ([]*DownloadRecord, error) {
	query := `
		SELECT id, username, content_id, content_name, file_path, file_size,
		       duration, width, height, has_audio, downloaded_at, thumbnail,
		       search_order, rank
		FROM downloads
		WHERE username = ?
		ORDER BY downloaded_at DESC
		LIMIT ?
	`

	rows, err := dm.db.Query(query, username, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query user downloads: %w", err)
	}
	defer rows.Close()

	var downloads []*DownloadRecord
	for rows.Next() {
		record := &DownloadRecord{}
		err := rows.Scan(
			&record.ID, &record.Username, &record.ContentID, &record.ContentName,
			&record.FilePath, &record.FileSize, &record.Duration, &record.Width,
			&record.Height, &record.HasAudio, &record.DownloadedAt, &record.Thumbnail,
			&record.SearchOrder, &record.Rank,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan download record: %w", err)
		}
		downloads = append(downloads, record)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating download records: %w", err)
	}

	return downloads, nil
}

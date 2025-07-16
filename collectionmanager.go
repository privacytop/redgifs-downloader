package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// CollectionManager handles collection-related operations
type CollectionManager struct {
	api *RedGifsAPI
	db  *DatabaseManager
}

// NewCollectionManager creates a new collection manager
func NewCollectionManager(api *RedGifsAPI, db *DatabaseManager) *CollectionManager {
	return &CollectionManager{
		api: api,
		db:  db,
	}
}

// GetUserCollections retrieves all collections for a user
func (cm *CollectionManager) GetUserCollections(username string) ([]*Collection, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"count": {"100"},
		"page":  {"1"},
	}

	endpoint := fmt.Sprintf("/users/%s/collections", username)
	resp, err := cm.api.doRequest(ctx, "GET", endpoint, params, nil, true)
	if err != nil {
		return nil, fmt.Errorf("failed to get collections: %w", err)
	}

	var apiResp APICollectionResponse
	if err := json.Unmarshal(resp, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse collections: %w", err)
	}

	collections := make([]*Collection, 0, len(apiResp.Collections))

	for _, col := range apiResp.Collections {
		// Determine best thumbnail URL
		thumbnailURL := ""
		if col.ThumbS != "" {
			thumbnailURL = col.ThumbS
		} else if col.ThumbA != "" {
			thumbnailURL = col.ThumbA
		}

		collections = append(collections, &Collection{
			ID:           col.FolderID,
			Name:         col.FolderName,
			Description:  col.Description,
			ContentCount: col.ContentCount,
			Thumbnail:    col.Thumb,
			ThumbnailURL: thumbnailURL,
			CreatedAt:    time.Unix(col.CreateDate, 0),
			Published:    col.Published,
		})
	}

	// Store collections in database
	if err := cm.db.StoreCollections(username, collections); err != nil {
		// Log error but don't fail the operation
		fmt.Printf("Failed to store collections: %v\n", err)
	}

	return collections, nil
}

// GetMyCollections retrieves collections for the authenticated user
func (cm *CollectionManager) GetMyCollections() ([]*Collection, error) {
	if !cm.api.IsAuthenticated() {
		return nil, fmt.Errorf("authentication required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"count": {"100"},
		"page":  {"1"},
	}

	resp, err := cm.api.doRequest(ctx, "GET", "/me/collections", params, nil, true)
	if err != nil {
		return nil, fmt.Errorf("failed to get my collections: %w", err)
	}

	var apiResp APICollectionResponse
	if err := json.Unmarshal(resp, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse collections: %w", err)
	}

	collections := make([]*Collection, 0, len(apiResp.Collections))

	for _, col := range apiResp.Collections {
		thumbnailURL := ""
		if col.ThumbS != "" {
			thumbnailURL = col.ThumbS
		} else if col.ThumbA != "" {
			thumbnailURL = col.ThumbA
		}

		collections = append(collections, &Collection{
			ID:           col.FolderID,
			Name:         col.FolderName,
			Description:  col.Description,
			ContentCount: col.ContentCount,
			Thumbnail:    col.Thumb,
			ThumbnailURL: thumbnailURL,
			CreatedAt:    time.Unix(col.CreateDate, 0),
			Published:    col.Published,
		})
	}

	return collections, nil
}

// GetCollectionContent retrieves content from a specific collection
func (cm *CollectionManager) GetCollectionContent(collectionID string, page int) (*ContentResponse, error) {
	if !cm.api.IsAuthenticated() {
		return nil, fmt.Errorf("authentication required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"count": {fmt.Sprintf("%d", cm.api.config.PageSize)},
		"page":  {fmt.Sprintf("%d", page)},
	}

	endpoint := fmt.Sprintf("/me/collections/%s/gifs", collectionID)
	resp, err := cm.api.doRequest(ctx, "GET", endpoint, params, nil, true)
	if err != nil {
		return nil, fmt.Errorf("failed to get collection content: %w", err)
	}

	var apiResp APIContentResponse
	if err := json.Unmarshal(resp, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse collection content: %w", err)
	}

	return cm.api.convertContentResponse(&apiResp), nil
}

// GetCollectionInfo retrieves detailed information about a collection
func (cm *CollectionManager) GetCollectionInfo(collectionID string) (*CollectionInfo, error) {
	// First, get the collection from cache if available
	collection, err := cm.db.GetCollection(collectionID)
	if err != nil {
		return nil, fmt.Errorf("collection not found: %w", err)
	}

	// Get first page of content to gather more info
	contentResp, err := cm.GetCollectionContent(collectionID, 1)
	if err != nil {
		return nil, err
	}

	// Calculate additional statistics
	info := &CollectionInfo{
		Collection:   collection,
		TotalContent: contentResp.Total,
		TotalPages:   contentResp.Pages,
	}

	// Get preview content (first 6 items)
	previewCount := 6
	if len(contentResp.Contents) < previewCount {
		previewCount = len(contentResp.Contents)
	}

	info.PreviewContent = contentResp.Contents[:previewCount]

	// Calculate total duration and size estimate
	for _, content := range contentResp.Contents {
		info.TotalDuration += content.Duration

		// Estimate size based on resolution and duration
		// This is a rough estimate: ~5MB per minute for HD
		if content.URLs.HD != "" {
			info.EstimatedSize += int64(content.Duration * 5 * 1024 * 1024 / 60)
		} else {
			info.EstimatedSize += int64(content.Duration * 2 * 1024 * 1024 / 60)
		}
	}

	return info, nil
}

// CollectionInfo contains detailed information about a collection
type CollectionInfo struct {
	Collection     *Collection `json:"collection"`
	TotalContent   int         `json:"total_content"`
	TotalPages     int         `json:"total_pages"`
	TotalDuration  float64     `json:"total_duration"`
	EstimatedSize  int64       `json:"estimated_size"`
	PreviewContent []*Content  `json:"preview_content"`
}

// SearchCollections searches through user's collections
func (cm *CollectionManager) SearchCollections(query string) ([]*Collection, error) {
	// Get all collections first
	collections, err := cm.GetMyCollections()
	if err != nil {
		return nil, err
	}

	// Filter collections based on query
	query = strings.ToLower(query)
	filtered := make([]*Collection, 0)

	for _, col := range collections {
		if strings.Contains(strings.ToLower(col.Name), query) ||
			strings.Contains(strings.ToLower(col.Description), query) {
			filtered = append(filtered, col)
		}
	}

	return filtered, nil
}

// GetRecentCollections retrieves recently accessed collections
func (cm *CollectionManager) GetRecentCollections(limit int) ([]*Collection, error) {
	return cm.db.GetRecentCollections(limit)
}

// MarkCollectionAccessed updates the last accessed time for a collection
func (cm *CollectionManager) MarkCollectionAccessed(collectionID string) error {
	return cm.db.UpdateCollectionAccessTime(collectionID)
}

// GetLikedContent retrieves the user's liked content
func (cm *CollectionManager) GetLikedContent(page int) (*ContentResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	params := url.Values{
		"count": {"100"},
		"page":  {fmt.Sprintf("%d", page)},
	}

	endpoint := "/feeds/liked"
	resp, err := cm.api.doRequest(ctx, "GET", endpoint, params, nil, true)
	if err != nil {
		return nil, fmt.Errorf("failed to get liked content: %w", err)
	}

	var apiResp APIContentResponse
	if err := json.Unmarshal(resp, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse liked content: %w", err)
	}

	// Convert to our format
	content := make([]*Content, 0, len(apiResp.Gifs))
	for _, gif := range apiResp.Gifs {
		content = append(content, &Content{
			ID:          gif.ID,
			Username:    gif.UserName,
			Title:       gif.Description,
			Description: gif.Description,
			Duration:    gif.Duration,
			Width:       gif.Width,
			Height:      gif.Height,
			Views:       gif.Views,
			Likes:       gif.Likes,
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
		})
	}

	return &ContentResponse{
		Contents: content,
		Page:     apiResp.Page,
		Pages:    apiResp.Pages,
		Total:    apiResp.Total,
	}, nil
}

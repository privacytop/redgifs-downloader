package main

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// UIEventManager handles real-time UI events and notifications
type UIEventManager struct {
	ctx         context.Context
	subscribers map[string][]chan interface{}
	mutex       sync.RWMutex
	
	// WebSocket connections for real-time updates
	wsConnections map[string]*websocket.Conn
	wsMutex       sync.RWMutex
}

// NewUIEventManager creates a new UI event manager
func NewUIEventManager(ctx context.Context) *UIEventManager {
	return &UIEventManager{
		ctx:           ctx,
		subscribers:   make(map[string][]chan interface{}),
		wsConnections: make(map[string]*websocket.Conn),
	}
}

// Event types
const (
	EventDownloadProgress = "download:progress"
	EventDownloadComplete = "download:complete"
	EventDownloadError    = "download:error"
	EventDownloadStarted  = "download:started"
	EventDownloadPaused   = "download:paused"
	EventDownloadResumed  = "download:resumed"
	EventDownloadCanceled = "download:canceled"
	
	EventAuthStatus       = "auth:status"
	EventAuthStarted      = "auth:started"
	EventAuthCompleted    = "auth:completed"
	EventAuthError        = "auth:error"
	
	EventCollectionLoaded = "collection:loaded"
	EventCollectionError  = "collection:error"
	
	EventNotification     = "notification"
	EventError           = "error"
	EventInfo            = "info"
	EventWarning         = "warning"
	EventSuccess         = "success"
)

// EventData represents event data structure
type EventData struct {
	Type      string      `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data"`
}

// DownloadProgressData represents download progress event data
type DownloadProgressData struct {
	TaskID      string  `json:"task_id"`
	Progress    float64 `json:"progress"`
	CurrentItem string  `json:"current_item"`
	Downloaded  int     `json:"downloaded"`
	Total       int     `json:"total"`
	Speed       string  `json:"speed,omitempty"`
	ETA         string  `json:"eta,omitempty"`
}

// DownloadCompleteData represents download completion event data
type DownloadCompleteData struct {
	TaskID       string        `json:"task_id"`
	Username     string        `json:"username"`
	Downloaded   int           `json:"downloaded"`
	Failed       int           `json:"failed"`
	Skipped      int           `json:"skipped"`
	Duration     time.Duration `json:"duration"`
	TotalSize    int64         `json:"total_size"`
}

// DownloadErrorData represents download error event data
type DownloadErrorData struct {
	TaskID   string `json:"task_id"`
	Error    string `json:"error"`
	Item     string `json:"item,omitempty"`
	Retrying bool   `json:"retrying"`
}

// NotificationData represents notification event data
type NotificationData struct {
	Title    string `json:"title"`
	Message  string `json:"message"`
	Type     string `json:"type"` // "info", "success", "warning", "error"
	Duration int    `json:"duration,omitempty"` // Duration in seconds, 0 for persistent
	Actions  []NotificationAction `json:"actions,omitempty"`
}

// NotificationAction represents an action button in a notification
type NotificationAction struct {
	Label  string `json:"label"`
	Action string `json:"action"`
	Style  string `json:"style,omitempty"` // "primary", "secondary", "danger"
}

// Subscribe subscribes to events of a specific type
func (uem *UIEventManager) Subscribe(eventType string) <-chan interface{} {
	uem.mutex.Lock()
	defer uem.mutex.Unlock()
	
	ch := make(chan interface{}, 100) // Buffered channel
	uem.subscribers[eventType] = append(uem.subscribers[eventType], ch)
	
	return ch
}

// Emit emits an event to all subscribers and the frontend
func (uem *UIEventManager) Emit(eventType string, data interface{}) {
	eventData := EventData{
		Type:      eventType,
		Timestamp: time.Now(),
		Data:      data,
	}
	
	// Emit to Wails frontend
	runtime.EventsEmit(uem.ctx, eventType, eventData)
	
	// Emit to local subscribers
	uem.mutex.RLock()
	subscribers := uem.subscribers[eventType]
	uem.mutex.RUnlock()
	
	for _, ch := range subscribers {
		select {
		case ch <- data:
		default:
			// Channel is full, skip this subscriber
			log.Printf("Warning: Event channel full for type %s", eventType)
		}
	}
	
	// Log important events
	switch eventType {
	case EventDownloadComplete, EventDownloadError, EventAuthCompleted, EventAuthError:
		if jsonData, err := json.Marshal(eventData); err == nil {
			log.Printf("Event: %s", string(jsonData))
		}
	}
}

// SendDownloadProgress sends download progress update
func (uem *UIEventManager) SendDownloadProgress(taskID string, progress float64, currentItem string) {
	data := DownloadProgressData{
		TaskID:      taskID,
		Progress:    progress,
		CurrentItem: currentItem,
	}
	uem.Emit(EventDownloadProgress, data)
}

// SendDownloadComplete sends download completion notification
func (uem *UIEventManager) SendDownloadComplete(taskID string) {
	data := DownloadCompleteData{
		TaskID: taskID,
	}
	uem.Emit(EventDownloadComplete, data)
}

// SendDownloadError sends download error notification
func (uem *UIEventManager) SendDownloadError(taskID string, err error) {
	data := DownloadErrorData{
		TaskID: taskID,
		Error:  err.Error(),
	}
	uem.Emit(EventDownloadError, data)
}

// SendDownloadStarted sends download started notification
func (uem *UIEventManager) SendDownloadStarted(taskID, username string, totalItems int) {
	data := map[string]interface{}{
		"task_id":     taskID,
		"username":    username,
		"total_items": totalItems,
	}
	uem.Emit(EventDownloadStarted, data)
}

// SendAuthStatus sends authentication status update
func (uem *UIEventManager) SendAuthStatus(authenticated bool) {
	data := map[string]interface{}{
		"authenticated": authenticated,
	}
	uem.Emit(EventAuthStatus, data)
}

// SendNotification sends a notification to the UI
func (uem *UIEventManager) SendNotification(notification NotificationData) {
	uem.Emit(EventNotification, notification)
}

// SendInfo sends an info notification
func (uem *UIEventManager) SendInfo(title, message string) {
	notification := NotificationData{
		Title:   title,
		Message: message,
		Type:    "info",
		Duration: 5,
	}
	uem.SendNotification(notification)
}

// SendSuccess sends a success notification
func (uem *UIEventManager) SendSuccess(title, message string) {
	notification := NotificationData{
		Title:   title,
		Message: message,
		Type:    "success",
		Duration: 5,
	}
	uem.SendNotification(notification)
}

// SendWarning sends a warning notification
func (uem *UIEventManager) SendWarning(title, message string) {
	notification := NotificationData{
		Title:   title,
		Message: message,
		Type:    "warning",
		Duration: 8,
	}
	uem.SendNotification(notification)
}

// SendError sends an error notification
func (uem *UIEventManager) SendError(title, message string) {
	notification := NotificationData{
		Title:   title,
		Message: message,
		Type:    "error",
		Duration: 0, // Persistent
	}
	uem.SendNotification(notification)
}

// SendCollectionLoaded sends collection loaded notification
func (uem *UIEventManager) SendCollectionLoaded(username string, collections []*Collection) {
	data := map[string]interface{}{
		"username":    username,
		"collections": collections,
		"count":       len(collections),
	}
	uem.Emit(EventCollectionLoaded, data)
}

// SendCollectionError sends collection error notification
func (uem *UIEventManager) SendCollectionError(username string, err error) {
	data := map[string]interface{}{
		"username": username,
		"error":    err.Error(),
	}
	uem.Emit(EventCollectionError, data)
}

// Cleanup cleans up resources
func (uem *UIEventManager) Cleanup() {
	uem.mutex.Lock()
	defer uem.mutex.Unlock()
	
	// Close all subscriber channels
	for eventType, subscribers := range uem.subscribers {
		for _, ch := range subscribers {
			close(ch)
		}
		delete(uem.subscribers, eventType)
	}
	
	// Close WebSocket connections
	uem.wsMutex.Lock()
	defer uem.wsMutex.Unlock()
	
	for id, conn := range uem.wsConnections {
		conn.Close()
		delete(uem.wsConnections, id)
	}
}

// GetEventHistory returns recent events (could be implemented with a ring buffer)
func (uem *UIEventManager) GetEventHistory(eventType string, limit int) []EventData {
	// This is a placeholder - in a real implementation, you'd maintain
	// a ring buffer of recent events
	return []EventData{}
}

// BroadcastSystemStatus broadcasts system status information
func (uem *UIEventManager) BroadcastSystemStatus() {
	status := map[string]interface{}{
		"timestamp":    time.Now(),
		"memory_usage": getMemoryUsage(),
		"goroutines":   getGoroutineCount(),
		"uptime":       getUptime(),
	}
	uem.Emit("system:status", status)
}

// Helper functions (placeholders)
func getMemoryUsage() string {
	// Implement memory usage calculation
	return "0 MB"
}

func getGoroutineCount() int {
	// Implement goroutine count
	return 0
}

func getUptime() time.Duration {
	// Implement uptime calculation
	return 0
}

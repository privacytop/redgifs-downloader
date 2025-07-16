package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/pkg/browser"
)

// OpenInExplorer opens a file or folder in the system file explorer
func OpenInExplorer(path string) error {
	// Ensure the path exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("path does not exist: %s", path)
	}

	// Convert to absolute path
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %w", err)
	}

	switch runtime.GOOS {
	case "windows":
		// Use explorer.exe to open the folder
		return exec.Command("explorer", "/select,", absPath).Start()
	case "darwin":
		// Use open command on macOS
		return exec.Command("open", "-R", absPath).Start()
	case "linux":
		// Try different file managers on Linux
		fileManagers := []string{"nautilus", "dolphin", "thunar", "pcmanfm", "caja"}
		
		// If it's a file, open the containing directory
		if !isDirectory(absPath) {
			absPath = filepath.Dir(absPath)
		}
		
		for _, fm := range fileManagers {
			if _, err := exec.LookPath(fm); err == nil {
				return exec.Command(fm, absPath).Start()
			}
		}
		
		// Fallback to xdg-open
		return exec.Command("xdg-open", absPath).Start()
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

// isDirectory checks if a path is a directory
func isDirectory(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// OpenURL opens a URL in the default browser
func OpenURL(url string) error {
	return browser.OpenURL(url)
}

// FormatFileSize formats a file size in bytes to a human-readable string
func FormatFileSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	
	units := []string{"KB", "MB", "GB", "TB", "PB"}
	return fmt.Sprintf("%.1f %s", float64(bytes)/float64(div), units[exp])
}

// FormatDuration formats a duration to a human-readable string
func FormatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%.0fs", d.Seconds())
	}
	if d < time.Hour {
		return fmt.Sprintf("%.0fm %.0fs", d.Minutes(), d.Seconds()-60*d.Minutes())
	}
	hours := int(d.Hours())
	minutes := int(d.Minutes()) - hours*60
	return fmt.Sprintf("%dh %dm", hours, minutes)
}

// FormatSpeed formats a download speed
func FormatSpeed(bytesPerSecond float64) string {
	if bytesPerSecond < 1024 {
		return fmt.Sprintf("%.0f B/s", bytesPerSecond)
	}
	if bytesPerSecond < 1024*1024 {
		return fmt.Sprintf("%.1f KB/s", bytesPerSecond/1024)
	}
	if bytesPerSecond < 1024*1024*1024 {
		return fmt.Sprintf("%.1f MB/s", bytesPerSecond/(1024*1024))
	}
	return fmt.Sprintf("%.1f GB/s", bytesPerSecond/(1024*1024*1024))
}

// SanitizeFilename sanitizes a filename by removing invalid characters
func SanitizeFilename(filename string) string {
	// Characters that are invalid in filenames on various systems
	invalidChars := []string{
		"<", ">", ":", "\"", "/", "\\", "|", "?", "*",
		"\x00", "\x01", "\x02", "\x03", "\x04", "\x05", "\x06", "\x07",
		"\x08", "\x09", "\x0a", "\x0b", "\x0c", "\x0d", "\x0e", "\x0f",
		"\x10", "\x11", "\x12", "\x13", "\x14", "\x15", "\x16", "\x17",
		"\x18", "\x19", "\x1a", "\x1b", "\x1c", "\x1d", "\x1e", "\x1f",
	}
	
	result := filename
	for _, char := range invalidChars {
		result = strings.ReplaceAll(result, char, "_")
	}
	
	// Remove leading/trailing spaces and dots
	result = strings.Trim(result, " .")
	
	// Ensure filename is not empty
	if result == "" {
		result = "unnamed"
	}
	
	// Limit length to 255 characters (common filesystem limit)
	if len(result) > 255 {
		ext := filepath.Ext(result)
		base := result[:255-len(ext)]
		result = base + ext
	}
	
	return result
}

// EnsureDir ensures that a directory exists, creating it if necessary
func EnsureDir(path string) error {
	return os.MkdirAll(path, 0755)
}

// FileExists checks if a file exists
func FileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

// GetFileSize returns the size of a file in bytes
func GetFileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// TruncateString truncates a string to a maximum length
func TruncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

// GenerateRankedFilename generates a filename with ranking prefix
func GenerateRankedFilename(originalName string, rank, totalCount int) string {
	ext := filepath.Ext(originalName)
	base := strings.TrimSuffix(originalName, ext)
	
	// Calculate the number of digits needed for the total count
	digits := len(fmt.Sprintf("%d", totalCount))
	
	// Format rank with leading zeros
	rankStr := fmt.Sprintf("%0*d", digits, rank)
	
	return fmt.Sprintf("%s_%s%s", rankStr, SanitizeFilename(base), ext)
}

// ParseContentURL extracts the content ID from a RedGifs URL
func ParseContentURL(url string) string {
	// Extract content ID from various RedGifs URL formats
	parts := strings.Split(url, "/")
	for i, part := range parts {
		if part == "watch" && i+1 < len(parts) {
			return parts[i+1]
		}
		if strings.Contains(part, "redgifs.com") && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	
	// If no specific pattern found, return the last part
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	
	return ""
}

// CalculateETA calculates estimated time of arrival based on progress and speed
func CalculateETA(progress float64, totalItems int, itemsPerSecond float64) time.Duration {
	if progress >= 1.0 || itemsPerSecond <= 0 {
		return 0
	}
	
	remainingItems := float64(totalItems) * (1.0 - progress)
	secondsRemaining := remainingItems / itemsPerSecond
	
	return time.Duration(secondsRemaining) * time.Second
}

// RetryWithBackoff executes a function with exponential backoff retry logic
func RetryWithBackoff(fn func() error, maxRetries int, initialDelay time.Duration) error {
	var lastErr error
	delay := initialDelay
	
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(delay)
			delay *= 2 // Exponential backoff
		}
		
		if err := fn(); err != nil {
			lastErr = err
			continue
		}
		
		return nil // Success
	}
	
	return fmt.Errorf("max retries (%d) exceeded: %w", maxRetries, lastErr)
}

// GetThumbnailPath generates a thumbnail file path for a given content file
func GetThumbnailPath(contentPath string) string {
	dir := filepath.Dir(contentPath)
	base := strings.TrimSuffix(filepath.Base(contentPath), filepath.Ext(contentPath))
	return filepath.Join(dir, ".thumbnails", base+".jpg")
}

// CreateThumbnailDir creates the thumbnail directory if it doesn't exist
func CreateThumbnailDir(contentPath string) error {
	thumbnailDir := filepath.Join(filepath.Dir(contentPath), ".thumbnails")
	return EnsureDir(thumbnailDir)
}

// IsValidURL checks if a string is a valid URL
func IsValidURL(str string) bool {
	return strings.HasPrefix(str, "http://") || strings.HasPrefix(str, "https://")
}

// ExtractUsernameFromURL extracts username from a RedGifs profile URL
func ExtractUsernameFromURL(url string) string {
	// Handle various RedGifs URL formats
	url = strings.TrimSpace(url)
	
	if strings.Contains(url, "redgifs.com/users/") {
		parts := strings.Split(url, "/users/")
		if len(parts) > 1 {
			username := strings.Split(parts[1], "/")[0]
			username = strings.Split(username, "?")[0] // Remove query parameters
			return username
		}
	}
	
	// If it's just a username without URL
	if !strings.Contains(url, "/") && !strings.Contains(url, ".") {
		return url
	}
	
	return ""
}

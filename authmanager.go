package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// AuthManager handles browser-based authentication
type AuthManager struct {
	api         *RedGifsAPI
	db          *DatabaseManager
	server      *http.Server
	authChannel chan authResult
	state       string
	stateMutex  sync.Mutex
	ctx         context.Context
}

type authResult struct {
	token string
	err   error
}

// NewAuthManager creates a new authentication manager
func NewAuthManager(ctx context.Context, api *RedGifsAPI, db *DatabaseManager) *AuthManager {
	return &AuthManager{
		api:         api,
		db:          db,
		authChannel: make(chan authResult, 1),
		ctx:         ctx,
	}
}

// Login initiates the browser-based login flow
func (am *AuthManager) Login(ctx context.Context) error {
	// Generate random state for CSRF protection
	am.stateMutex.Lock()
	stateBytes := make([]byte, 32)
	if _, err := rand.Read(stateBytes); err != nil {
		am.stateMutex.Unlock()
		return fmt.Errorf("failed to generate state: %w", err)
	}
	am.state = base64.URLEncoding.EncodeToString(stateBytes)
	am.stateMutex.Unlock()

	// Start local HTTP server
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("failed to start auth server: %w", err)
	}

	port := listener.Addr().(*net.TCPAddr).Port
	callbackURL := fmt.Sprintf("http://localhost:%d/callback", port)

	// Create HTTP server
	mux := http.NewServeMux()
	mux.HandleFunc("/callback", am.handleCallback)
	mux.HandleFunc("/success", am.handleSuccess)

	am.server = &http.Server{
		Handler:     mux,
		ReadTimeout: 5 * time.Minute,
	}

	// Start server in background
	go func() {
		if err := am.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("Auth server error: %v", err)
		}
	}()

	// Build auth URL
	authURL := am.buildAuthURL(callbackURL)

	// Open browser
	if err := openBrowser(authURL); err != nil {
		am.server.Close()
		return fmt.Errorf("failed to open browser: %w", err)
	}

	// Show notification
	if am.ctx != nil {
		runtime.EventsEmit(am.ctx, "auth:started", map[string]interface{}{
			"message": "Please complete login in your browser",
		})
	}

	// Wait for auth result
	select {
	case result := <-am.authChannel:
		am.server.Close()

		if result.err != nil {
			return result.err
		}

		// Store token
		am.api.SetToken(result.token)
		if err := am.db.StoreToken(result.token); err != nil {
			log.Printf("Failed to store token: %v", err)
		}

		// Emit success event
		if am.ctx != nil {
			runtime.EventsEmit(am.ctx, "auth:completed", map[string]interface{}{
				"success": true,
			})
		}

		return nil

	case <-time.After(5 * time.Minute):
		am.server.Close()
		return fmt.Errorf("authentication timeout")

	case <-ctx.Done():
		am.server.Close()
		return ctx.Err()
	}
}

// buildAuthURL constructs the RedGifs OAuth URL
func (am *AuthManager) buildAuthURL(callbackURL string) string {
	// Note: This is a simplified example. RedGifs might use a different auth flow
	// You'll need to check their actual OAuth documentation
	params := url.Values{
		"client_id":     {"redgifs-downloader"},
		"redirect_uri":  {callbackURL},
		"response_type": {"token"},
		"scope":         {"read write"},
		"state":         {am.state},
	}

	return fmt.Sprintf("https://www.redgifs.com/oauth/authorize?%s", params.Encode())
}

// handleCallback handles the OAuth callback
func (am *AuthManager) handleCallback(w http.ResponseWriter, r *http.Request) {
	// Extract token from fragment (for implicit flow)
	// Note: Actual implementation depends on RedGifs OAuth flow

	// For demonstration, we'll handle a simple token callback
	token := r.URL.Query().Get("token")
	state := r.URL.Query().Get("state")

	// Verify state
	am.stateMutex.Lock()
	expectedState := am.state
	am.stateMutex.Unlock()

	if state != expectedState {
		am.authChannel <- authResult{err: fmt.Errorf("invalid state parameter")}
		http.Error(w, "Invalid state", http.StatusBadRequest)
		return
	}

	if token == "" {
		// Try to extract from fragment using JavaScript
		html := `
		<!DOCTYPE html>
		<html>
		<head>
			<title>RedGifs Login</title>
			<style>
				body {
					font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
					display: flex;
					justify-content: center;
					align-items: center;
					height: 100vh;
					margin: 0;
					background: #1a202c;
					color: white;
				}
				.container {
					text-align: center;
				}
				.spinner {
					border: 3px solid #f3f3f3;
					border-top: 3px solid #3498db;
					border-radius: 50%;
					width: 40px;
					height: 40px;
					animation: spin 1s linear infinite;
					margin: 0 auto 20px;
				}
				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="spinner"></div>
				<h2>Completing login...</h2>
				<p>You will be redirected shortly.</p>
			</div>
			<script>
				// Extract token from URL fragment
				const hash = window.location.hash.substring(1);
				const params = new URLSearchParams(hash);
				const token = params.get('access_token') || params.get('token');
				
				if (token) {
					// Send token to server
					window.location.href = '/success?token=' + encodeURIComponent(token);
				} else {
					// Check query parameters
					const queryParams = new URLSearchParams(window.location.search);
					const queryToken = queryParams.get('token');
					if (queryToken) {
						window.location.href = '/success?token=' + encodeURIComponent(queryToken);
					} else {
						alert('Authentication failed: No token received');
						window.close();
					}
				}
			</script>
		</body>
		</html>
		`
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(html))
		return
	}

	// Redirect to success page
	http.Redirect(w, r, fmt.Sprintf("/success?token=%s", url.QueryEscape(token)), http.StatusFound)
}

// handleSuccess handles successful authentication
func (am *AuthManager) handleSuccess(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")

	if token == "" {
		am.authChannel <- authResult{err: fmt.Errorf("no token received")}
		http.Error(w, "No token received", http.StatusBadRequest)
		return
	}

	// Send success result
	am.authChannel <- authResult{token: token}

	// Show success page
	html := `
	<!DOCTYPE html>
	<html>
	<head>
		<title>Login Successful</title>
		<style>
			body {
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
				display: flex;
				justify-content: center;
				align-items: center;
				height: 100vh;
				margin: 0;
				background: #1a202c;
				color: white;
			}
			.container {
				text-align: center;
			}
			.checkmark {
				width: 56px;
				height: 56px;
				border-radius: 50%;
				background: #48bb78;
				margin: 0 auto 20px;
				display: flex;
				justify-content: center;
				align-items: center;
			}
			.checkmark::after {
				content: '✓';
				color: white;
				font-size: 30px;
			}
			button {
				background: #3182ce;
				color: white;
				border: none;
				padding: 10px 20px;
				border-radius: 5px;
				font-size: 16px;
				cursor: pointer;
				margin-top: 20px;
			}
			button:hover {
				background: #2c5aa0;
			}
		</style>
	</head>
	<body>
		<div class="container">
			<div class="checkmark"></div>
			<h2>Login Successful!</h2>
			<p>You can now close this window and return to the application.</p>
			<button onclick="window.close()">Close Window</button>
		</div>
		<script>
			// Auto-close after 3 seconds
			setTimeout(() => {
				window.close();
			}, 3000);
		</script>
	</body>
	</html>
	`
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
}

// openBrowser opens the default web browser
func openBrowser(url string) error {
	// Use a simple approach that works across platforms
	return OpenURL(url)
}

// MockLogin performs a mock login for development
func (am *AuthManager) MockLogin(ctx context.Context) error {
	// Generate a mock token
	mockToken := "mock.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ik1vY2sgVXNlciIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

	am.api.SetToken(mockToken)
	if err := am.db.StoreToken(mockToken); err != nil {
		return fmt.Errorf("failed to store mock token: %w", err)
	}

	if am.ctx != nil {
		runtime.EventsEmit(am.ctx, "auth:completed", map[string]interface{}{
			"success": true,
			"mock":    true,
		})
	}

	return nil
}

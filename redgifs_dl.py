#!/usr/bin/env python3
import os
import sys
import httpx
import asyncio
import sqlite3
import argparse
import time
import json
import re
import random
from urllib.parse import urlparse, unquote
from datetime import datetime, timedelta
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Dict, Set, Tuple, Optional, Any, Deque
from functools import lru_cache
import logging
import platform
from collections import deque

try:
    import rich
    from rich.console import Console
    from rich.progress import Progress, TextColumn, BarColumn, TaskProgressColumn, TimeRemainingColumn, SpinnerColumn
    from rich.logging import RichHandler
    from rich.panel import Panel
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

__version__ = "2.1.0"

# Setup basic logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[RichHandler(rich_tracebacks=True)] if RICH_AVAILABLE else [logging.StreamHandler()]
)
logger = logging.getLogger("redgifs_dl")

# Set up console output with Rich if available
console = Console() if RICH_AVAILABLE else None


@dataclass
class Config:
    # Paths
    root_path: str = ""
    database_path: str = "redgifs_dl.db"
    
    # Download settings
    min_concurrent_downloads: int = 5
    max_concurrent_downloads: int = 50
    download_timeout: int = 60
    api_timeout: int = 30
    retry_attempts: int = 5
    retry_delay: int = 3
    
    # API settings
    search_orders: List[str] = None
    page_size: int = 100
    max_pages_per_order: int = 30
    
    # Performance monitoring
    response_times: Deque[float] = field(default_factory=lambda: deque(maxlen=100))
    failed_requests: int = 0
    successful_requests: int = 0
    
    # Rate limiting
    rate_limit_delay: float = 0.5  # Start with a small delay
    rate_limit_hits: int = 0
    rate_limit_window: Deque[float] = field(default_factory=lambda: deque(maxlen=50))
    rate_limit_reset_time: float = 0
    rate_limit_max_backoff: float = 60.0  # Maximum backoff in seconds
    rate_limit_min_backoff: float = 0.2   # Minimum backoff in seconds
    
    # Quality setting
    quality: str = "hd"  # "hd" or "sd"
    
    def __post_init__(self):
        if self.search_orders is None:
            self.search_orders = ["top", "trending", "recent", "best", "latest"]


class RateLimiter:
    """Advanced rate limiter with dynamic adjustment"""
    
    def __init__(self, config: Config):
        self.config = config
        self.last_request_time = 0
        self.consecutive_failures = 0
        self.consecutive_successes = 0
        self.backoff_factor = 1.0
        self.current_delay = config.rate_limit_min_backoff
        self.reset_times = deque(maxlen=10)  # Track recent reset times
        
    async def wait_if_needed(self):
        """Wait before making a request based on current rate limit understanding"""
        now = time.time()
        
        # Check if we're in a rate limit cooldown period
        if now < self.config.rate_limit_reset_time:
            wait_time = self.config.rate_limit_reset_time - now
            logger.debug(f"Rate limit cooldown active. Waiting {wait_time:.2f}s until reset")
            await asyncio.sleep(wait_time)
            return
        
        # Apply dynamic delay based on recent history
        if self.last_request_time > 0:
            # Calculate time since last request
            elapsed = now - self.last_request_time
            
            # If we need to wait based on our current delay
            if elapsed < self.current_delay:
                wait_time = self.current_delay - elapsed
                
                # Add small jitter (±10%) to avoid request synchronization
                jitter = wait_time * random.uniform(-0.1, 0.1)
                wait_time += jitter
                
                if wait_time > 0:
                    logger.debug(f"Rate limiting: waiting {wait_time:.3f}s")
                    await asyncio.sleep(wait_time)
        
        self.last_request_time = time.time()
    
    def update_after_success(self):
        """Update rate limiting parameters after a successful request"""
        self.consecutive_failures = 0
        self.consecutive_successes += 1
        
        # Gradually reduce delay after consecutive successes
        if self.consecutive_successes >= 10:
            self.current_delay = max(
                self.config.rate_limit_min_backoff,
                self.current_delay * 0.95  # Reduce by 5%
            )
            logger.debug(f"Reduced rate limit delay to {self.current_delay:.3f}s after consecutive successes")
    
    def update_after_failure(self, status_code=None, response_data=None):
        """Update rate limiting parameters after a failed request"""
        self.consecutive_successes = 0
        self.consecutive_failures += 1
        
        # Check for rate limit information in response body
        if status_code == 429 and response_data:
            try:
                # Try to parse JSON response
                if isinstance(response_data, str):
                    try:
                        response_data = json.loads(response_data)
                    except:
                        pass
                
                # Extract delay from RedGifs rate limit response format
                if isinstance(response_data, dict) and 'error' in response_data:
                    error_data = response_data['error']
                    if 'delay' in error_data:
                        delay_seconds = float(error_data['delay'])
                        self.reset_times.append(delay_seconds)
                        
                        # Calculate average from recent delays for more stability
                        avg_delay = sum(self.reset_times) / len(self.reset_times)
                        
                        # Set explicit cooldown period
                        self.config.rate_limit_reset_time = time.time() + avg_delay
                        
                        # Also update our delay based on this information
                        self.current_delay = min(
                            self.config.rate_limit_max_backoff,
                            max(self.config.rate_limit_min_backoff, avg_delay * 0.1)  # 10% of reset time
                        )
                        
                        logger.warning(f"Rate limited! API requested {delay_seconds:.1f}s wait. "
                                      f"Setting delay to {self.current_delay:.2f}s")
                        return
            except Exception as e:
                logger.debug(f"Error parsing rate limit response: {e}")
        
        # Default exponential backoff
        if status_code == 429 or (self.consecutive_failures > 2 and status_code >= 500):
            # Exponential increase
            self.backoff_factor = min(32, self.backoff_factor * 2)
            self.current_delay = min(
                self.config.rate_limit_max_backoff,
                self.current_delay * 1.5  # Increase by 50%
            )
            
            logger.warning(f"Increasing rate limit delay to {self.current_delay:.3f}s after failures")
            
            # If we keep hitting failures, set a cooldown period
            if self.consecutive_failures >= 5:
                cooldown = self.current_delay * 2
                self.config.rate_limit_reset_time = time.time() + cooldown
                logger.warning(f"Too many consecutive failures. Cooling down for {cooldown:.1f}s")


class TokenBucket:
    """Token bucket algorithm for smoothing request rates"""
    
    def __init__(self, rate: float, capacity: float):
        """
        Initialize token bucket with rate (tokens/second) and capacity.
        """
        self.rate = rate        # Rate at which tokens are added (per second)
        self.capacity = capacity  # Maximum number of tokens
        self.tokens = capacity  # Current token count, start with full bucket
        self.last_update = time.time()  # Last time tokens were added
        self.lock = asyncio.Lock()  # For thread safety
    
    async def consume(self, tokens: float = 1.0) -> float:
        """
        Consume tokens from the bucket. Returns the time to wait if not enough tokens.
        """
        async with self.lock:
            now = time.time()
            
            # Add new tokens based on time elapsed
            elapsed = now - self.last_update
            new_tokens = elapsed * self.rate
            
            # Update token count but don't exceed capacity
            self.tokens = min(self.capacity, self.tokens + new_tokens)
            self.last_update = now
            
            # If we have enough tokens, consume them and return 0 wait time
            if self.tokens >= tokens:
                self.tokens -= tokens
                return 0.0
            
            # Otherwise, calculate wait time until enough tokens are available
            additional_tokens_needed = tokens - self.tokens
            wait_time = additional_tokens_needed / self.rate
            
            # Don't consume tokens yet, we'll wait and try again
            return wait_time
    
    async def wait_for_tokens(self, tokens: float = 1.0):
        """
        Wait until the specified number of tokens is available, then consume them.
        """
        wait_time = await self.consume(tokens)
        if wait_time > 0:
            await asyncio.sleep(wait_time)
            # After waiting, tokens should be available
            await self.consume(tokens)


class AdaptiveConcurrency:
    """Dynamically adjusts concurrency based on performance metrics"""
    
    def __init__(self, config: Config):
        self.config = config
        self.current_concurrency = config.min_concurrent_downloads
        self.semaphore = asyncio.Semaphore(self.current_concurrency)
        self.last_adjustment = time.time()
        self.adjustment_interval = 5  # seconds between adjustments
        self.token_bucket = TokenBucket(rate=10, capacity=20)  # Start with conservative rate
        
    async def acquire(self):
        """Acquire the semaphore with rate limiting"""
        # First wait for a token from the token bucket
        await self.token_bucket.wait_for_tokens()
        # Then acquire the semaphore
        await self.semaphore.acquire()
        
    def release(self):
        """Release the semaphore"""
        self.semaphore.release()
        
    def adjust_concurrency(self):
        """Adjust concurrency based on response times and failure rates"""
        now = time.time()
        if now - self.last_adjustment < self.adjustment_interval:
            return
            
        self.last_adjustment = now
        
        # Calculate metrics
        total_requests = self.config.successful_requests + self.config.failed_requests
        if total_requests < 10:  # Need enough data to make decisions
            return
            
        failure_rate = self.config.failed_requests / total_requests if total_requests > 0 else 0
        avg_response_time = sum(self.config.response_times) / len(self.config.response_times) if self.config.response_times else 0
        
        # Adjust token bucket rate based on success/failure
        if failure_rate > 0.2 or self.config.rate_limit_hits > 0:
            # Reduce token rate if we're having issues
            new_rate = max(1, self.token_bucket.rate * 0.8)
            logger.debug(f"Reducing token bucket rate to {new_rate:.1f} req/s due to failures")
            self.token_bucket.rate = new_rate
            self.config.rate_limit_hits = 0
        elif failure_rate < 0.05 and avg_response_time < 1.0:
            # Increase token rate if everything is going well
            new_rate = min(30, self.token_bucket.rate * 1.1)
            logger.debug(f"Increasing token bucket rate to {new_rate:.1f} req/s")
            self.token_bucket.rate = new_rate
        
        # Adjust concurrency level
        if failure_rate > 0.1:
            # Too many failures, reduce concurrency
            new_concurrency = max(self.config.min_concurrent_downloads, 
                                 int(self.current_concurrency * 0.8))
        elif avg_response_time > 3.0 and self.current_concurrency > self.config.min_concurrent_downloads:
            # Slow responses, reduce concurrency slightly
            new_concurrency = max(self.config.min_concurrent_downloads, 
                                 self.current_concurrency - 2)
        elif avg_response_time < 1.0 and failure_rate < 0.05:
            # Fast responses and low failures, increase concurrency
            new_concurrency = min(self.config.max_concurrent_downloads, 
                                self.current_concurrency + 3)
        else:
            # Maintain current level
            new_concurrency = self.current_concurrency
            
        # Apply the new concurrency if it changed
        if new_concurrency != self.current_concurrency:
            self.current_concurrency = new_concurrency
            old_semaphore = self.semaphore
            self.semaphore = asyncio.Semaphore(new_concurrency)
            
            # If increasing concurrency, release additional permits
            if new_concurrency > old_semaphore._value:
                for _ in range(new_concurrency - old_semaphore._value):
                    try:
                        old_semaphore.release()
                    except ValueError:
                        # Semaphore was already at max value
                        pass
                        
            logger.info(f"Adjusted concurrency to {new_concurrency} downloads")


class DatabaseManager:
    def __init__(self, database_path: str):
        self.database_path = Path(database_path)
        self.conn = None
        self.cursor = None
        
    def connect(self):
        """Connect to the database and set up tables"""
        self.conn = sqlite3.connect(self.database_path)
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()
        
        # Create tables if they don't exist
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS downloads (
                username TEXT, 
                video_name TEXT, 
                rank INTEGER,
                search_order TEXT,
                downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (username, video_name)
            )
        """)
        
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS failed_downloads (
                username TEXT,
                video_name TEXT,
                url TEXT,
                attempts INTEGER DEFAULT 1,
                last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                error_message TEXT,
                PRIMARY KEY (username, video_name)
            )
        """)
        
        # Add indices for performance
        self.cursor.execute("CREATE INDEX IF NOT EXISTS idx_downloads_username ON downloads (username)")
        self.cursor.execute("CREATE INDEX IF NOT EXISTS idx_failed_username ON failed_downloads (username)")
        
        self.conn.commit()
        
    def close(self):
        """Close the database connection"""
        if self.conn:
            self.conn.commit()
            self.conn.close()
            
    def __enter__(self):
        self.connect()
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    def get_existing_downloads(self, username: str) -> Dict[str, Tuple[int, str]]:
        """Get all downloads for a username from the database"""
        self.cursor.execute(
            "SELECT video_name, rank, search_order FROM downloads WHERE username = ?",
            (username,),
        )
        return {row[0]: (row[1], row[2]) for row in self.cursor.fetchall()}
        
    def record_downloads(self, data: List[Tuple[str, str, int, str]]):
        """Record successful downloads in bulk"""
        if not data:
            return
            
        self.cursor.executemany(
            """
            INSERT OR REPLACE INTO downloads 
            (username, video_name, rank, search_order) 
            VALUES (?, ?, ?, ?)
            """,
            data
        )
        self.conn.commit()
        
    def record_failed_download(self, username: str, video_name: str, url: str, error_message: str):
        """Record a failed download"""
        self.cursor.execute(
            """
            INSERT INTO failed_downloads (username, video_name, url, error_message)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(username, video_name) 
            DO UPDATE SET attempts = attempts + 1, last_attempt = CURRENT_TIMESTAMP, error_message = ?
            """,
            (username, video_name, url, error_message, error_message),
        )
        self.conn.commit()
        
    def clear_failed_downloads(self, username: str):
        """Clear failed downloads to retry"""
        self.cursor.execute("DELETE FROM failed_downloads WHERE username = ?", (username,))
        self.conn.commit()


class RedGifsAPI:
    """Handles all RedGifs API interactions"""
    
    BASE_URL = "https://api.redgifs.com"
    
    def __init__(self, config: Config):
        self.config = config
        self.token = None
        self.headers = {}
        self.token_expiry = 0
        self.rate_limiter = RateLimiter(config)
        
    async def init_session(self) -> httpx.AsyncClient:
        """Initialize a session with proper timeout and limits"""
        limits = httpx.Limits(max_keepalive_connections=100, max_connections=200)
        timeout = httpx.Timeout(self.config.api_timeout)
        return httpx.AsyncClient(limits=limits, timeout=timeout)
        
    async def get_token(self, session: httpx.AsyncClient) -> str:
        """Get or refresh the authentication token"""
        now = time.time()
        
        # If token exists and is not expired, return it
        if self.token and now < self.token_expiry - 300:  # Refresh 5 minutes before expiry
            return self.token
            
        # Get new token
        try:
            # Wait for rate limiter
            await self.rate_limiter.wait_if_needed()
            
            response = await session.get(f"{self.BASE_URL}/v2/auth/temporary")
            
            if response.status_code == 200:
                data = response.json()
                self.token = data["token"]
                # Tokens are usually valid for 1 hour, but set expiry conservatively
                self.token_expiry = now + 3600
                self.rate_limiter.update_after_success()
                return self.token
            elif response.status_code == 429:
                # Handle rate limiting for token request
                try:
                    error_data = response.json()
                    self.rate_limiter.update_after_failure(response.status_code, error_data)
                except Exception:
                    self.rate_limiter.update_after_failure(response.status_code)
                raise Exception(f"Rate limited while getting token: {response.status_code}")
            else:
                self.rate_limiter.update_after_failure(response.status_code)
                raise Exception(f"Failed to get token: {response.status_code}")
        except Exception as e:
            logger.error(f"Failed to get auth token: {e}")
            self.rate_limiter.update_after_failure()
            raise
            
    async def fetch_with_retry(self, session: httpx.AsyncClient, url: str) -> dict:
        """Fetch data from API with unlimited retries for rate limits"""
        max_total_retries = 20  # Maximum retries for non-rate-limit errors
        non_rate_retries = 0
        
        while True:  # Keep trying until we succeed or hit non-rate-limit retry limit
            try:
                # Get fresh token if needed
                token = await self.get_token(session)
                headers = {"Authorization": f"Bearer {token}"}
                
                # Wait for rate limiter
                await self.rate_limiter.wait_if_needed()
                
                start_time = time.time()
                response = await session.get(url, headers=headers)
                elapsed = time.time() - start_time
                
                # Track response time
                self.config.response_times.append(elapsed)
                
                # Handle different response codes
                if response.status_code == 200:
                    # Success
                    self.config.successful_requests += 1
                    self.rate_limiter.update_after_success()
                    return response.json()
                
                elif response.status_code == 429:
                    # Rate limit - we'll retry indefinitely for these
                    self.config.rate_limit_hits += 1
                    
                    # Extract rate limit info from response body
                    try:
                        error_data = response.json()
                        logger.warning(f"Rate limited! Response: {error_data}")
                        
                        # Update rate limiter with the response data
                        self.rate_limiter.update_after_failure(response.status_code, error_data)
                        
                        # Get the delay from the error data if available
                        delay = 5  # Default
                        if 'error' in error_data and 'delay' in error_data['error']:
                            delay = int(error_data['error']['delay'])
                            
                        logger.warning(f"Rate limited! Waiting {delay}s before retrying...")
                        await asyncio.sleep(delay + 1)  # Add a small buffer
                    except Exception as e:
                        # If we can't parse the response, use default backoff
                        logger.warning(f"Error parsing rate limit response: {e}")
                        self.rate_limiter.update_after_failure(response.status_code)
                        await asyncio.sleep(5)
                        
                    continue  # Retry immediately after wait
                
                elif response.status_code >= 500:
                    # Server error - retry with backoff
                    logger.warning(f"Server error {response.status_code}, retrying...")
                    non_rate_retries += 1
                    
                    # Update rate limiter
                    self.rate_limiter.update_after_failure(response.status_code)
                    
                    if non_rate_retries >= max_total_retries:
                        self.config.failed_requests += 1
                        raise Exception(f"Maximum retries exceeded for server errors: {response.status_code}")
                    
                    # Wait with exponential backoff
                    wait_time = min(60, 2 ** non_rate_retries)
                    await asyncio.sleep(wait_time)
                    continue
                
                elif response.status_code == 404:
                    # Not found - no point retrying
                    logger.warning(f"Resource not found (404): {url}")
                    self.config.failed_requests += 1
                    return {"gifs": [], "pages": 0, "total": 0}
                
                else:
                    # Other client errors
                    logger.error(f"API error: {response.status_code} - {response.text}")
                    non_rate_retries += 1
                    
                    # Update rate limiter
                    self.rate_limiter.update_after_failure(response.status_code)
                    
                    if non_rate_retries >= max_total_retries:
                        self.config.failed_requests += 1
                        raise Exception(f"Maximum retries exceeded: {response.status_code}")
                    
                    # Wait with exponential backoff
                    wait_time = min(60, 2 ** non_rate_retries)
                    await asyncio.sleep(wait_time)
                    continue
                    
            except (httpx.ConnectError, httpx.ReadError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
                # Network errors
                logger.warning(f"Network error: {e}")
                non_rate_retries += 1
                
                # Update rate limiter as this could be an implicit rate limit
                self.rate_limiter.update_after_failure()
                
                if non_rate_retries >= max_total_retries:
                    self.config.failed_requests += 1
                    raise Exception(f"Maximum retries exceeded after network errors: {e}")
                
                # Wait with exponential backoff
                wait_time = min(60, 2 ** non_rate_retries)
                await asyncio.sleep(wait_time)
            
            except Exception as e:
                # Other unexpected errors
                logger.error(f"Unexpected error: {e}")
                non_rate_retries += 1
                
                # Update rate limiter
                self.rate_limiter.update_after_failure()
                
                if non_rate_retries >= max_total_retries:
                    self.config.failed_requests += 1
                    raise Exception(f"Maximum retries exceeded after errors: {e}")
                
                # Wait with exponential backoff
                wait_time = min(60, 2 ** non_rate_retries)
                await asyncio.sleep(wait_time)
    
    async def fetch_user_gifs(self, session: httpx.AsyncClient, username: str, search_order: str, page: int) -> Dict:
        """Fetch a page of gifs for a user with the given search order"""
        url = f"{self.BASE_URL}/v2/users/{username}/search?order={search_order}&count={self.config.page_size}&page={page}"
        return await self.fetch_with_retry(session, url)


class Downloader:
    """Handles downloading and processing of RedGifs content"""
    
    def __init__(self, config: Config, db_manager: DatabaseManager, api: RedGifsAPI):
        self.config = config
        self.db = db_manager
        self.api = api
        self.adaptive_concurrency = AdaptiveConcurrency(config)
        self.successful_downloads = 0
        self.skipped_downloads = 0
        self.failed_downloads = 0
        
    def format_rank(self, rank: int, total_count: int) -> str:
        """Format rank with leading zeros for proper sorting"""
        digits = len(str(total_count))
        return f"{rank:0{digits}d}"
    
    async def download_file(self, 
                          session: httpx.AsyncClient,
                          url: str, 
                          output_path: Path) -> bool:
        """Download a file with unlimited retries for rate limits"""
        max_other_retries = self.config.retry_attempts
        other_retries = 0
        rate_limit_retries = 0
        
        while True:  # Keep trying until we succeed or hit non-rate-limit retry limit
            try:
                # Wait for rate limiter
                await self.api.rate_limiter.wait_if_needed()
                
                start_time = time.time()
                
                # Try to fetch the content
                async with session.stream("GET", url, timeout=self.config.download_timeout) as response:
                    if response.status_code == 200:
                        # Create parent directories if they don't exist
                        output_path.parent.mkdir(parents=True, exist_ok=True)
                        
                        # Download the file
                        with output_path.open('wb') as f:
                            async for chunk in response.aiter_bytes(chunk_size=16384):
                                f.write(chunk)
                        
                        # Track download time for adaptive concurrency
                        elapsed = time.time() - start_time
                        self.config.response_times.append(elapsed)
                        self.config.successful_requests += 1
                        
                        # Update rate limiter
                        self.api.rate_limiter.update_after_success()
                        
                        # Update concurrency based on performance
                        self.adaptive_concurrency.adjust_concurrency()
                        
                        return True
                    
                    elif response.status_code == 429:
                        # Rate limit hit
                        rate_limit_retries += 1
                        
                        # Try to get the error data from the response
                        try:
                            error_data = await response.json()
                            delay = 5  # Default
                            if 'error' in error_data and 'delay' in error_data['error']:
                                delay = int(error_data['error']['delay'])
                                
                            logger.warning(f"Rate limited during download! Waiting {delay}s... (attempt {rate_limit_retries})")
                            
                            # Update rate limiter
                            self.api.rate_limiter.update_after_failure(response.status_code, error_data)
                            
                            # Wait the requested time plus a small buffer
                            await asyncio.sleep(delay + 1)
                        except Exception:
                            # If we can't parse the response, use default backoff
                            self.api.rate_limiter.update_after_failure(response.status_code)
                            await asyncio.sleep(5)
                            
                        continue  # Try again after waiting
                    
                    else:
                        # Other HTTP errors
                        error_msg = f"HTTP Error {response.status_code}"
                        logger.warning(f"Download failed: {error_msg} (attempt {other_retries+1}/{max_other_retries})")
                        
                        # Update rate limiter
                        self.api.rate_limiter.update_after_failure(response.status_code)
                        
                        other_retries += 1
                        if other_retries >= max_other_retries:
                            self.config.failed_requests += 1
                            return False
                        
                        # Wait with exponential backoff
                        wait_time = self.config.retry_delay * (2 ** other_retries)
                        await asyncio.sleep(min(60, wait_time))  # Cap at 60 seconds
                
            except (httpx.ConnectError, httpx.ReadError, httpx.ConnectTimeout, httpx.ReadTimeout) as e:
                # Network errors could be implicit rate limits
                error_msg = str(e)
                logger.warning(f"Network error during download: {error_msg} (attempt {other_retries+1}/{max_other_retries})")
                
                # Check if this might be a rate limit issue
                if "ConnectionResetError" in error_msg or "RemoteDisconnected" in error_msg:
                    # Treat as potential rate limit
                    rate_limit_retries += 1
                    
                    # Update rate limiter with more aggressive backoff
                    self.api.rate_limiter.update_after_failure(429, None)
                    
                    # Wait longer for these
                    wait_time = min(60, 5 * (2 ** rate_limit_retries))
                    await asyncio.sleep(wait_time)
                else:
                    # Other network error
                    other_retries += 1
                    
                    # Update rate limiter
                    self.api.rate_limiter.update_after_failure()
                    
                    if other_retries >= max_other_retries:
                        self.config.failed_requests += 1
                        return False
                    
                    # Wait with exponential backoff
                    wait_time = self.config.retry_delay * (2 ** other_retries)
                    await asyncio.sleep(min(60, wait_time))
            
            except Exception as e:
                # Other unexpected errors
                error_msg = str(e)
                logger.warning(f"Unexpected error during download: {error_msg} (attempt {other_retries+1}/{max_other_retries})")
                
                other_retries += 1
                
                # Update rate limiter
                self.api.rate_limiter.update_after_failure()
                
                if other_retries >= max_other_retries:
                    self.config.failed_requests += 1
                    return False
                
                # Wait with exponential backoff
                wait_time = self.config.retry_delay * (2 ** other_retries)
                await asyncio.sleep(min(60, wait_time))
    
    async def process_video(self, 
                          session: httpx.AsyncClient,
                          username: str,
                          url: str, 
                          folder_path: Path, 
                          rank: int, 
                          total_count: int,
                          search_order: str,
                          existing_videos: Dict[str, Tuple[int, str]],
                          pending_videos: Set[str],
                          dry_run: bool = False) -> Tuple[int, int, int]:
        """Process a single video: check if exists, download if needed, and update database"""
        video_name = unquote(urlparse(url).path.split("/")[-1].split("?")[0])
        base_name, extension = os.path.splitext(video_name)
        
        # Format with ranking prefix for sorting
        ranked_name = f"{self.format_rank(rank, total_count)}_{video_name}"
        video_path = folder_path / ranked_name
        
        # Skip if this video is already being processed in this run
        if video_name in pending_videos:
            return 0, 1, 0
            
        pending_videos.add(video_name)
        
        # Check if video is already in database with rank info
        if video_name in existing_videos:
            stored_rank, stored_order = existing_videos[video_name]
            
            # Only update if this rank is better than stored one
            if stored_rank is not None and rank >= stored_rank:
                return 0, 1, 0
                
            # Look for existing file with any rank prefix
            pattern = re.compile(r'\d+_' + re.escape(video_name) + '$')
            existing_file = None
            
            for file_path in folder_path.glob(f"*_{video_name}"):
                if pattern.search(str(file_path.name)):
                    existing_file = file_path
                    break
            
            if existing_file:
                # If we have a better rank, rename the file
                try:
                    if not dry_run:
                        existing_file.rename(video_path)
                    logger.info(f"Renamed {existing_file.name} to {ranked_name} (better rank)")
                    
                    # Record the updated rank
                    return 0, 1, 0
                except Exception as e:
                    logger.error(f"Failed to rename {existing_file.name}: {e}")
                    return 0, 0, 1
                    
            # If no existing file found but in database, download with new rank
        
        # Check for existing files with the same name but different rank
        pattern = re.compile(r'\d+_' + re.escape(video_name) + '$')
        for file_path in folder_path.glob(f"*_{video_name}"):
            if pattern.search(str(file_path.name)):
                # Already exists with some rank
                # Compare ranks to see if renaming is needed
                match = re.match(r'^(\d+)_', file_path.name)
                if match:
                    file_rank = int(match.group(1))
                    if rank < file_rank:
                        # New rank is better, rename
                        if not dry_run:
                            try:
                                file_path.rename(video_path)
                                logger.info(f"Renamed {file_path.name} to {ranked_name} (better rank)")
                            except Exception as e:
                                logger.error(f"Failed to rename {file_path.name}: {e}")
                    return 0, 1, 0  # Skip download since file exists
        
        # If we're only doing a dry run, don't download
        if dry_run:
            return 1, 0, 0  # Count as "would download"
            
        # Download the file
        async with self.adaptive_concurrency.semaphore:
            success = await self.download_file(session, url, video_path)
            
            if success:
                logger.info(f"Downloaded {ranked_name}")
                return 1, 0, 0
            else:
                logger.error(f"Failed to download {ranked_name}")
                # Record the failure
                self.db.record_failed_download(username, video_name, url, "Download failed after retries")
                return 0, 0, 1
                
    async def fetch_all_gifs(self, 
                           session: httpx.AsyncClient, 
                           username: str,
                           existing_videos: Dict[str, Tuple[int, str]]) -> List[Tuple[str, int, str]]:
        """Fetch all gifs for a user across all search orders"""
        all_gifs = []
        seen_urls = set()
        stats = {}
        
        # Try each search order
        for search_order in self.config.search_orders:
            stats[search_order] = {"total": 0, "new": 0}
            
            try:
                # Get first page to determine total pages
                first_page = await self.api.fetch_user_gifs(session, username, search_order, 1)
                
                if not first_page:
                    logger.warning(f"No data returned for search order: {search_order}")
                    continue
                    
                total_pages = min(first_page.get("pages", 1), self.config.max_pages_per_order)
                total_gifs = first_page.get("total", 0)
                
                if total_gifs == 0:
                    logger.info(f"No gifs found for order={search_order}")
                    continue
                    
                logger.info(f"Found {total_gifs} gifs across {total_pages} pages with order={search_order}")
                
                # Process first page gifs
                gifs = first_page.get("gifs", [])
                base_rank = 0
                
                for i, gif in enumerate(gifs):
                    rank = base_rank + i + 1
                    links = gif.get("urls", {})
                    url = links.get(self.config.quality) or links.get("hd") or links.get("sd")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_gifs.append((url, rank, search_order))
                        stats[search_order]["new"] += 1
                
                stats[search_order]["total"] += len(gifs)
                
                # Fetch remaining pages
                tasks = []
                for page in range(2, total_pages + 1):
                    tasks.append(self.api.fetch_user_gifs(session, username, search_order, page))
                
                # Process results as they come in
                for i, future in enumerate(asyncio.as_completed(tasks)):
                    try:
                        page_data = await future
                        page_gifs = page_data.get("gifs", [])
                        base_rank = (i + 1) * self.config.page_size
                        
                        for j, gif in enumerate(page_gifs):
                            rank = base_rank + j + 1
                            links = gif.get("urls", {})
                            url = links.get(self.config.quality) or links.get("hd") or links.get("sd")
                            
                            if url and url not in seen_urls:
                                seen_urls.add(url)
                                all_gifs.append((url, rank, search_order))
                                stats[search_order]["new"] += 1
                        
                        stats[search_order]["total"] += len(page_gifs)
                        logger.info(f"Fetched {len(page_gifs)} gifs from page {i+2} for order={search_order}")
                        
                    except Exception as e:
                        logger.error(f"Error fetching page for order={search_order}: {e}")
            
            except Exception as e:
                logger.error(f"Error processing search order={search_order}: {e}")
        
        # Log stats
        for order, data in stats.items():
            logger.info(f"Order '{order}': {data['total']} total gifs, {data['new']} new unique gifs")
        
        logger.info(f"Total unique gifs found across all orders: {len(all_gifs)}")
        
        # Sort by rank to process higher-ranked videos first
        all_gifs.sort(key=lambda x: x[1])
        
        return all_gifs
                
    async def download_user_content(self, username: str, dry_run: bool = False) -> Dict[str, Any]:
        """Download all content for a user"""
        username = username.replace("https://www.redgifs.com/users/", "").strip()
        logger.info(f"Processing content for user: {username}")
        
        start_time = time.time()
        
        # Setup download folder
        if self.config.root_path:
            root_path = Path(self.config.root_path)
            download_folder = root_path / f"RedGifs - {username}"
        else:
            download_folder = Path(f"RedGifs - {username}")
        
        if not download_folder.exists() and not dry_run:
            download_folder.mkdir(parents=True, exist_ok=True)
        
        # Get existing downloads from database
        existing_videos = self.db.get_existing_downloads(username)
        logger.info(f"Found {len(existing_videos)} existing downloads in database")
        
        # Clear failed downloads to try again
        self.db.clear_failed_downloads(username)
        
        # Initialize HTTP session
        session = await self.api.init_session()
        
        try:
            # Fetch all gifs
            all_gifs = await self.fetch_all_gifs(session, username, existing_videos)
            
            if dry_run:
                logger.info(f"DRY RUN: Would download {len(all_gifs)} videos")
                return {
                    "username": username,
                    "total_found": len(all_gifs),
                    "would_download": len(all_gifs),
                    "already_exists": len(existing_videos),
                    "elapsed_time": time.time() - start_time
                }
            
            if not all_gifs:
                logger.info("No new videos to download")
                return {
                    "username": username,
                    "total_found": 0,
                    "downloaded": 0,
                    "skipped": 0,
                    "failed": 0,
                    "already_exists": len(existing_videos),
                    "elapsed_time": time.time() - start_time
                }
            
            # Set up tracking for this download operation
            total_count = len(all_gifs)
            pending_videos = set()
            download_records = []
            
            # Set up progress display
            if RICH_AVAILABLE and not dry_run:
                progress = Progress(
                    SpinnerColumn(),
                    TextColumn("[bold blue]{task.description}"),
                    BarColumn(),
                    TaskProgressColumn(),
                    TextColumn("[cyan]{task.fields[downloaded]}[/] downloaded, [yellow]{task.fields[skipped]}[/] skipped, [red]{task.fields[failed]}[/] failed"),
                    TimeRemainingColumn(),
                )
                task_id = progress.add_task(
                    f"[cyan]Downloading {username}'s content...", 
                    total=total_count,
                    downloaded=0,
                    skipped=0,
                    failed=0
                )
            
            # Process all videos
            total_found = len(all_gifs)
            self.successful_downloads = 0
            self.skipped_downloads = 0
            self.failed_downloads = 0
            
            download_start_time = time.time()
            
            if RICH_AVAILABLE and not dry_run:
                with progress:
                    tasks = []
                    for url, rank, search_order in all_gifs:
                        task = self.process_video(
                            session, username, url, download_folder,
                            rank, total_found, search_order, existing_videos, pending_videos, dry_run
                        )
                        tasks.append(task)
                        
                    for i, future in enumerate(asyncio.as_completed(tasks)):
                        downloaded, skipped, failed = await future
                        
                        self.successful_downloads += downloaded
                        self.skipped_downloads += skipped
                        self.failed_downloads += failed
                        
                        if downloaded:
                            video_name = unquote(urlparse(all_gifs[i][0]).path.split("/")[-1].split("?")[0])
                            download_records.append((username, video_name, all_gifs[i][1], all_gifs[i][2]))
                            
                        progress.update(
                            task_id, 
                            advance=1, 
                            downloaded=self.successful_downloads,
                            skipped=self.skipped_downloads,
                            failed=self.failed_downloads
                        )
                        
                        # Periodically save to database
                        if len(download_records) >= 10:
                            self.db.record_downloads(download_records)
                            download_records = []
            else:
                # Non-rich progress reporting
                tasks = []
                for url, rank, search_order in all_gifs:
                    task = self.process_video(
                        session, username, url, download_folder,
                        rank, total_found, search_order, existing_videos, pending_videos, dry_run
                    )
                    tasks.append(task)
                    
                for i, future in enumerate(asyncio.as_completed(tasks)):
                    downloaded, skipped, failed = await future
                    
                    self.successful_downloads += downloaded
                    self.skipped_downloads += skipped
                    self.failed_downloads += failed
                    
                    if downloaded:
                        video_name = unquote(urlparse(all_gifs[i][0]).path.split("/")[-1].split("?")[0])
                        download_records.append((username, video_name, all_gifs[i][1], all_gifs[i][2]))
                    
                    # Simple progress output
                    completed = i + 1
                    percentage = (completed / total_count) * 100
                    
                    if i % 10 == 0 or completed == total_count:
                        logger.info(f"Progress: {completed}/{total_count} ({percentage:.1f}%) - Downloaded: {self.successful_downloads}, Skipped: {self.skipped_downloads}, Failed: {self.failed_downloads}")
                    
                    # Periodically save to database
                    if len(download_records) >= 10:
                        self.db.record_downloads(download_records)
                        download_records = []
            
            # Record remaining successful downloads in database
            if download_records:
                self.db.record_downloads(download_records)
                
            # Calculate stats
            elapsed_total = time.time() - start_time
            download_speed = self.successful_downloads / (time.time() - download_start_time) if self.successful_downloads > 0 else 0
            
            # Return results
            return {
                "username": username,
                "total_found": total_found,
                "downloaded": self.successful_downloads,
                "skipped": self.skipped_downloads,
                "failed": self.failed_downloads,
                "already_exists": len(existing_videos),
                "elapsed_time": elapsed_total,
                "download_speed": download_speed
            }
            
        except Exception as e:
            logger.error(f"Error processing user {username}: {str(e)}")
            raise
        finally:
            await session.aclose()

# --- Venv auto-relaunch logic ---
def in_venv():
    return (
        hasattr(sys, 'real_prefix') or
        (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)
    )

def relaunch_in_venv():
    venv_dir = os.path.join(os.getcwd(), 'venv')
    if os.name == 'nt':
        python_path = os.path.join(venv_dir, 'Scripts', 'python.exe')
    else:
        python_path = os.path.join(venv_dir, 'bin', 'python')
    if os.path.exists(python_path):
        print(f"Relaunching in venv: {python_path}")
        os.execv(python_path, [python_path] + sys.argv)

if not in_venv():
    venv_dir = os.path.join(os.getcwd(), 'venv')
    if os.path.isdir(venv_dir):
        relaunch_in_venv()

async def main(args):
    """Main entry point"""
    # Initialize components
    config = Config(
        root_path=args.root_path or "",
        database_path=args.database_path or "redgifs_dl.db",
        min_concurrent_downloads=5,
        max_concurrent_downloads=args.max_concurrency or 50,
        download_timeout=args.timeout or 60,
        retry_attempts=args.retries or 5
    )
    
    if args.verbose:
        logger.setLevel(logging.DEBUG)
    
    # Banner
    if RICH_AVAILABLE:
        console.print(f"[bold cyan]RedGifs Downloader v{__version__}[/bold cyan]")
        console.print("[yellow]Super-fast, concurrent downloader for RedGifs content[/yellow]")
        console.print(f"[dim]Running on Python {platform.python_version()} - {platform.system()} {platform.release()}[/dim]")
        console.print("[dim]Created by privacytop on 2025-03-23[/dim]")
        console.print("")
    else:
        print(f"RedGifs Downloader v{__version__}")
        print("Super-fast, concurrent downloader for RedGifs content")
        print(f"Running on Python {platform.python_version()} - {platform.system()} {platform.release()}")
        print("Created by privacytop on 2025-03-23")
        print("")
    
    # Initialize database
    with DatabaseManager(config.database_path) as db:
        api = RedGifsAPI(config)
        downloader = Downloader(config, db, api)
        
        usernames = []
        
        # Process batch file or list
        if args.batch:
            batch_path = Path(args.batch)
            if batch_path.is_file():
                with open(batch_path, "r") as batch_file:
                    for line in batch_file:
                        line = line.strip()
                        if line and not line.startswith("#"):
                            usernames.append(line)
            else:
                usernames = [u.strip() for u in args.batch.split(",") if u.strip()]
        
        # Process single username
        elif args.username:
            usernames = [args.username]
        else:
            # Interactive mode
            username = input("Enter RedGifs username to download: ")
            usernames = [username]
            
        # Process all usernames
        results = []
        for username in usernames:
            try:
                if RICH_AVAILABLE:
                    console.rule(f"[bold]Processing {username}[/bold]")
                else:
                    print(f"\n{'=' * 40}\nProcessing {username}\n{'=' * 40}\n")
                    
                result = await downloader.download_user_content(username, args.dry_run)
                results.append(result)
                
                # Print summary
                if RICH_AVAILABLE:
                    if args.dry_run:
                        console.print(f"[green]Would download [bold]{result['would_download']}[/bold] videos for [bold]{username}[/bold][/green]")
                    else:
                        console.print(f"[green]Downloaded [bold]{result['downloaded']}[/bold] videos for [bold]{username}[/bold][/green]")
                        console.print(f"[yellow]Skipped: [bold]{result['skipped']}[/bold][/yellow]")
                        console.print(f"[red]Failed: [bold]{result['failed']}[/bold][/red]")
                        
                    mins, secs = divmod(result['elapsed_time'], 60)
                    time_str = f"{int(mins)}m {int(secs)}s"
                    console.print(f"[blue]Time taken: [bold]{time_str}[/bold][/blue]")
                    
                    if result.get('download_speed'):
                        console.print(f"[cyan]Download speed: [bold]{result['download_speed']:.2f}[/bold] files/second[/cyan]")
                else:
                    if args.dry_run:
                        print(f"Would download {result['would_download']} videos for {username}")
                    else:
                        print(f"Downloaded {result['downloaded']} videos for {username}")
                        print(f"Skipped: {result['skipped']}")
                        print(f"Failed: {result['failed']}")
                        
                    mins, secs = divmod(result['elapsed_time'], 60)
                    time_str = f"{int(mins)}m {int(secs)}s"
                    print(f"Time taken: {time_str}")
                    
                    if result.get('download_speed'):
                        print(f"Download speed: {result['download_speed']:.2f} files/second")
                        
            except Exception as e:
                logger.error(f"Error processing {username}: {e}")
                
        # Print final summary if multiple users
        if len(results) > 1:
            total_downloaded = sum(r.get('downloaded', 0) for r in results)
            total_found = sum(r.get('total_found', 0) for r in results)
            total_skipped = sum(r.get('skipped', 0) for r in results)
            total_failed = sum(r.get('failed', 0) for r in results)
            
            if RICH_AVAILABLE:
                console.rule("[bold]Overall Summary[/bold]")
                console.print(f"[bold green]Total Downloaded: {total_downloaded}[/bold green]")
                console.print(f"[bold yellow]Total Skipped: {total_skipped}[/bold yellow]")
                console.print(f"[bold red]Total Failed: {total_failed}[/bold red]")
                console.print(f"[bold blue]Total Files Processed: {total_downloaded + total_skipped + total_failed}[/bold blue]")
            else:
                print("\n" + "=" * 40)
                print("Overall Summary")
                print("=" * 40)
                print(f"Total Downloaded: {total_downloaded}")
                print(f"Total Skipped: {total_skipped}")
                print(f"Total Failed: {total_failed}")
                print(f"Total Files Processed: {total_downloaded + total_skipped + total_failed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Super-fast RedGifs Downloader')
    
    # Main options
    parser.add_argument('-u', '--username', help='Username or profile URL to download')
    parser.add_argument('-b', '--batch', help='Path to a file with usernames, or comma-separated list of usernames')
    parser.add_argument('-o', '--root-path', help='Root path for downloaded files')
    parser.add_argument('-d', '--database-path', help='Path for the download history database')
    
    # Performance options
    parser.add_argument('-c', '--max-concurrency', type=int, help='Maximum number of concurrent downloads (default: auto)')
    parser.add_argument('-t', '--timeout', type=int, help='Download timeout in seconds (default: 60)')
    parser.add_argument('-r', '--retries', type=int, help='Number of retry attempts for failed downloads (default: 5)')
    
    # Other options
    parser.add_argument('--dry-run', action='store_true', help="Don't download files, just show what would be downloaded")
    parser.add_argument('--skip-history', action='store_true', help='Download files even if they are in the history')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    parser.add_argument('--version', action='version', version=f'RedGifs Downloader v{__version__}')
    parser.add_argument("--quality", choices=["hd", "sd"], default="hd", help="Download quality: hd or sd (default: hd)")
    
    args = parser.parse_args()
    
    try:
        if platform.system() == 'Windows':
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print("\nDownload interrupted by user. Exiting...")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unhandled error: {e}")
        sys.exit(1)

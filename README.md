# RedGifs Downloader

![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.7%2B-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A super-fast, intelligent downloader for RedGifs content with automatic rate limit handling and ranked file organization.

## Features

- **Smart Ranking System**: Files are named with rank prefixes so they'll sort by popularity
- **Adaptive Speed**: Automatically optimizes concurrency and request rates
- **Complete Downloads**: Never skips content due to rate limits, will patiently wait and retry
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Multiple Search Orders**: Gets more content by combining "top", "trending", "recent", etc.
- **Beautiful Progress Display**: Clean interface with rich progress bars (when Rich is installed)
- **Batch Processing**: Download multiple users with a single command
- **Database Tracking**: Maintains history to avoid duplicate downloads and preserve rankings

## Installation

1. Ensure you have Python 3.7 or newer installed
2. Install required dependencies:
   ```
   pip install httpx
   ```
3. Optional but recommended: Install Rich for better UI
   ```
   pip install rich
   ```
4. Download the script: `redgifs_dl.py`

## Quick Start

```bash
# Download a single user's content
python redgifs_dl.py -u username

# Download from multiple users
python redgifs_dl.py -b "user1,user2,user3"

# Use a text file with usernames (one per line)
python redgifs_dl.py -b users.txt

# Preview what would be downloaded without actually downloading
python redgifs_dl.py -u username --dry-run
```

## Command Line Options

```
Usage: redgifs_dl.py [OPTIONS]

Options:
  -u, --username USERNAME     Username or profile URL to download
  -b, --batch BATCH           Path to a file with usernames, or comma-separated list
  -o, --root-path PATH        Root path for downloaded files
  -d, --database-path PATH    Path for the download history database
  -c, --max-concurrency N     Maximum number of concurrent downloads (default: auto)
  -t, --timeout SECONDS       Download timeout in seconds (default: 60)
  -r, --retries COUNT         Number of retry attempts for failed downloads (default: 5)
  --dry-run                   Don't download files, just show what would be downloaded
  --skip-history              Download files even if they are in the history
  --verbose                   Enable verbose logging
  --version                   Show version and exit
```

## File Organization

Files are downloaded with a numbered prefix that represents their ranking:

```
001_example_video.mp4  # Top ranked video
002_another_video.mp4  # Second highest ranked video
...
```

This numbering system allows you to easily see the most popular content first when sorting by filename.

## How It Works

RedGifs Downloader uses several advanced techniques:

1. **Adaptive Concurrency**: Automatically adjusts how many downloads run simultaneously based on performance and API response
2. **Token Bucket Algorithm**: Smooths out request rates to avoid triggering rate limits
3. **Intelligent Backoff**: When rate limited, respects the server's exact delay requirements
4. **Multiple Search Orders**: Fetches content using different sort methods to maximize the number of unique files
5. **Database Tracking**: Remembers what's been downloaded and preserves ranking information

## Requirements

- Python 3.7+
- HTTPX library (`pip install httpx`)
- Optional: Rich library for enhanced display (`pip install rich`)

## Troubleshooting

### Rate Limiting

The downloader intelligently handles rate limits by:
- Parsing the exact delay time provided by the RedGifs API
- Waiting precisely the required time before retrying
- Never giving up on downloads due to rate limiting

If you see rate limit messages, don't worry - the script will automatically wait and retry.

### Slow Downloads

If downloads seem slow:
1. Check your internet connection
2. Be patient during rate limit periods (the script will automatically retry)
3. Reduce concurrency with `-c 5` if you're experiencing network issues

### Database Issues

If you need to start fresh:
1. Delete or rename the database file (`redgifs_dl.db` by default)
2. Run the script again to create a new database

## Advanced Usage

### Custom Root Directory

```bash
python redgifs_dl.py -u username -o "/path/to/downloads"
```

### Custom Database Path

```bash
python redgifs_dl.py -u username -d "/path/to/database.db"
```

### Re-download All Content

```bash
python redgifs_dl.py -u username --skip-history
```

### High-Speed Mode (for fast connections)

```bash
python redgifs_dl.py -u username -c 20
```

### Installing Dependencies

If you encounter dependency errors, install all required packages:

```bash
pip install httpx rich
```

## License

MIT License

## Author

Created by privacytop on 2023-03-23

---

## Legal Disclaimer

This tool is provided for educational purposes only. Users are responsible for ensuring they comply with RedGifs' terms of service and all applicable laws when using this software.

import os
import sys
import subprocess
import shutil
import tempfile
import urllib.request
import zipfile

GITHUB_REPO = "privacytop/redgifs-downloader"
RELEASES_URL = f"https://github.com/{GITHUB_REPO}/archive/refs/heads/main.zip"
REQUIREMENTS = "requirements.txt"


def ask_venv():
    print("Do you want to use a Python virtual environment? [Y/n]: ", end="")
    choice = input().strip().lower()
    return choice in ("", "y", "yes")


def create_venv(venv_dir):
    print(f"Creating virtual environment in {venv_dir}...")
    subprocess.check_call([sys.executable, "-m", "venv", venv_dir])
    print("Virtual environment created.")
    return venv_dir


def get_pip_path(venv_dir):
    if os.name == "nt":
        return os.path.join(venv_dir, "Scripts", "pip.exe")
    else:
        return os.path.join(venv_dir, "bin", "pip")


def install_requirements(pip_path):
    if not os.path.exists(REQUIREMENTS):
        print(f"{REQUIREMENTS} not found. Creating a minimal one...")
        with open(REQUIREMENTS, "w") as f:
            f.write("httpx\nrich\n")
    print("Installing dependencies...")
    subprocess.check_call([pip_path, "install", "-r", REQUIREMENTS])
    print("Dependencies installed.")


def download_latest():
    print("Downloading latest version from GitHub...")
    with tempfile.TemporaryDirectory() as tmpdir:
        zip_path = os.path.join(tmpdir, "main.zip")
        urllib.request.urlretrieve(RELEASES_URL, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(tmpdir)
        # Copy files to current directory
        src_dir = os.path.join(tmpdir, f"{GITHUB_REPO.split('/')[1]}-main")
        for item in os.listdir(src_dir):
            s = os.path.join(src_dir, item)
            d = os.path.join(os.getcwd(), item)
            if os.path.isdir(s):
                if os.path.exists(d):
                    shutil.rmtree(d)
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)
    print("Latest version downloaded and installed.")


def main():
    print("RedGifs Downloader Installer\n-----------------------------")
    use_venv = ask_venv()
    venv_dir = "venv" if use_venv else None
    pip_path = sys.executable.replace("python.exe", "pip.exe") if not use_venv else None

    if use_venv:
        venv_dir = create_venv("venv")
        pip_path = get_pip_path(venv_dir)
        print(f"To activate your venv, run: source venv/bin/activate (Linux/Mac) or venv\\Scripts\\activate (Windows)")
    else:
        print("Using system Python environment.")
        pip_path = shutil.which("pip")
        if not pip_path:
            print("pip not found. Please install pip and rerun this script.")
            sys.exit(1)

    install_requirements(pip_path)
    download_latest()

    print("\nInstallation complete!")
    print("To run the downloader, use:")
    print("  python redgifs_dl.py")
    print("Or, once available:")
    print("  python gui.py")

if __name__ == "__main__":
    main()

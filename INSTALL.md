# 🛠️ Karuda Setup & Installation Guide

This guide covers everything you need to set up Karuda on Windows, macOS, and Linux. Since Karuda is built with **Tauri**, you need to install the system dependencies for Rust and WebView development first.

---

## 📋 Prerequisites (Global)

Regardless of your OS, you will need:
1.  **Rust & Toolchain**: Install via [rustup.rs](https://rustup.rs/)
2.  **Bun**: The recommended runtime for Karuda. Install via [bun.sh](https://bun.sh/)
3.  **API Keys**: A `.env` file in `src-tauri/.env` (see README for details).

---

## 🪟 Windows Installation

### 1. System Dependencies
Install the **C++ Build Tools** via the [Visual Studio Installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/):
- Select "Desktop development with C++"
- Ensure "MSVC", "Windows SDK", and "CMake" are checked.

### 2. Setup Karuda
```powershell
# Clone the repository (if you haven't)
# cd Karuda

# Install JS dependencies
bun install

# Start in development mode
bun start
```

---

## 🍎 macOS Installation

### 1. System Dependencies
You need **Xcode Command Line Tools**:
```bash
xcode-select --install
```

### 2. Setup Karuda
```bash
# Install JS dependencies
bun install

# Start in development mode
bun run start
```
*Note: You may be prompted to grant "Accessibility" or "Input Monitoring" permissions because Karuda simulates keyboard input.*

---

## 🐧 Linux Installation

### 1. System Dependencies
You need `webkit2gtk`, `libayatana-appindicator` (for tray), and build essentials.

**Ubuntu / Debian / Pop!_OS:**
```bash
sudo apt update
sudo apt install -y \
  libgtk-3-dev \
  webkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  build-essential \
  curl \
  wget \
  pkg-config \
  libssl-dev \
  libasound2-dev \
  libx11-dev \
  libxtst-dev
```

**Fedora / RHEL / CentOS:**
For RHEL/CentOS, you first need to enable the **CRB** (CodeReady Builder) and **EPEL** repositories to access development headers:

```bash
# RHEL 9 / Rocky Linux 9 / AlmaLinux 9
sudo dnf config-manager --set-enabled crb
sudo dnf install epel-release epel-next-release

# Install Dependencies
sudo dnf install \
  webkit2gtk4.1-devel \
  openssl-devel \
  libayatana-appindicator-devel \
  librsvg2-devel \
  alsa-lib-devel \
  gcc \
  gcc-c++ \
  make \
  pkgconf-pkg-config \
  libX11-devel \
  libXtst-devel
```


**Arch Linux:**
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl \
  wget \
  openssl \
  appindicator-gtk3 \
  librsvg \
  alsa-lib \
  libx11 \
  libxtst
```

### 2. Setup Karuda
```bash
# Install JS dependencies
bun install

# Start in development mode
bun run start
```

---

## 🚀 Building for Production

To create a standalone installer for your current OS:
```bash
bun run tauri build
```
The output will be in `src-tauri/target/release/bundle/`.

---

## 💡 Troubleshooting

- **Rust Version**: Ensure you are on the latest stable Rust (`rustup update stable`).
- **WebView2 (Windows)**: Most modern Windows systems have this, but if not, download the "Evergreen Bootstrapper" from Microsoft.
- **Microphone**: Ensure you have granted microphone permissions to your terminal or the compiled Karuda app in your OS privacy settings.

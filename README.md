<div align="center">

# Crispenator

**Upscale low resolution images right inside Photoshop using OpenAI**
One click to export your canvas, send it to the model, and place the result back as a crisp new layer.

[![UXP](https://img.shields.io/badge/Photoshop-UXP-blue)](#requirements)
[![OpenAI](https://img.shields.io/badge/OpenAI-gpt--image--1-black)](#how-it-works)
[![License](https://img.shields.io/badge/License-MIT-informational)](#license)

</div>

---

## Table of contents

- [Highlights](#highlights)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Using Crispenator](#using-crispenator)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Privacy](#privacy)
- [Folder structure](#folder-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- Native Photoshop UXP panel with a clean single purpose UI
- One click Upscale button plus a compact settings modal for your API key
- Sends a flattened copy of your current document to OpenAI and places the result as a new layer named **CrispenatorOutput**
- Automatically chooses an output size that matches your document aspect ratio from **1024x1024**, **1792x1024**, or **1024x1792**
- Progress bar with clear status updates and friendly error messages

---

## Requirements

- Adobe Photoshop **26.0.0** or newer
- UXP **manifest version 5**
- Network access to **api.openai.com** and local file system access for read and write inside the plugin data folder

These targets and permissions are declared in `manifest.json`.

---

## Installation

### Option A. Load for development with UXP Developer Tool

1. Clone or download this repository.
2. Open **Adobe UXP Developer Tool**.
3. Add the plugin by selecting this folder that contains `manifest.json`.
4. Click **Run** in UDT, then in Photoshop open **Window → Plugins → Crispenator**.

### Option B. Install distributable

Download the latest release and install the ccx file through Creative Cloud Desktop.


---

## Quick start

1. Open an image or composite in Photoshop.
2. Open **Window → Plugins → Crispenator** to show the panel.
3. Click the gear icon to open **Settings** and paste your **OpenAI API key**. It is saved locally in the plugin data folder.
4. Click **Upscale**. Crispenator duplicates and flattens the active document to a temporary copy, exports it to `input.png`, and begins generation.
5. Watch the progress bar. When complete a new layer named **CrispenatorOutput** appears in your document.

---

## Using Crispenator

### Enter your API key

- Click the **gear** icon in the panel.
- Paste your key and **Save**. The key is written to `key.txt` under the plugin data folder using UXP file system helpers.
- You can update the key at any time using the same dialog.

### Run an upscale

- Click **Upscale** to start.
- The plugin performs a safe duplicate and flatten on a temporary document, exports a PNG, then closes the temporary document to avoid touching your original.
- The generated result is written to `output.png` and placed into your active document as a new layer named **CrispenatorOutput**.

---

## How it works

Crispenator follows a three stage pipeline.

1. **Export**
   The active document is duplicated, flattened, and saved as `input.png` into the plugin data folder. This uses UXP storage plus Photoshop batchPlay actions.

2. **Generate**
   The plugin uploads `input.png` to the **OpenAI Images Edits** endpoint with model **gpt-image-1**. It supplies a concise prompt for quality upscaling and automatically selects the closest size among `1024x1024`, `1792x1024`, or `1024x1792` based on your document aspect ratio.

3. **Place**
   The returned base64 image is written to `output.png` and placed into the active Photoshop document as a new layer. The layer is renamed to **CrispenatorOutput** for easy reference.

The panel UI provides a progress bar, percent indicator, and status messages for success or error.

---

## Troubleshooting

- **Nothing happens when I click Upscale**
  Make sure you have at least one open document and that an API key is saved. The panel will prompt for a key if none is found.

- **OpenAI error with a code**
  Errors from the API are surfaced with the returned status and text so you can adjust your key or account as needed.

- **I do not see the result layer**
  Look for a new layer named **CrispenatorOutput** at the top of the layer stack.

---

## FAQ

**Does the plugin modify my original document**
No. Crispenator duplicates and flattens a temporary copy for export. The original stays untouched.

**Where is my API key stored**
In a local `key.txt` file inside the plugin data folder on your machine.

**Can I control the output size**
Current version auto picks from three sizes to preserve aspect ratio. Size selection UI and more ratios are on the roadmap.

---

## Privacy

- The plugin requests local file system access and network access to `api.openai.com` only.
- Your API key stays on your machine in `key.txt` and is used only to call the OpenAI API.
- The **Privacy policy** link in the panel opens `https://crispenator.com` in your default browser.

---

## Folder structure

```
root
├─ index.html            Panel UI
├─ styles.css            Panel styles
├─ main.js               UXP logic and Photoshop actions
├─ manifest.json         UXP manifest v5
└─ icons/                Panel icon assets
```

---

## Contributing

Issues and pull requests are welcome. Please include your Photoshop version and platform plus steps to reproduce any bug.

---

## License

MIT. See the **LICENSE** file for details.

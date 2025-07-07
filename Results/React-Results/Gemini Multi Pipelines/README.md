## Features

- **Frontend-Only**: Your API key is stored securely in your browser's local storage
- **Multi-Model Chat**: Compare responses from different Gemini models simultaneously
- **Configuration Testing**: Test different temperature and top-P settings side by side
- **Image Generation**: Generate images using Gemini's image models
- **Secure**: API keys never leave your browser except to communicate with Google's APIs

## Run Locally

**Prerequisites:** Node.js 16+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the app:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to the local development URL (typically `http://localhost:5173`)

4. When the app loads, you'll be prompted to enter your Gemini API key

## Getting Your API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Create a new API key
4. Copy the key and paste it into the app when prompted

## Security

- Your API key is stored locally in your browser using localStorage
- The key is never sent to any server except Google's Gemini API
- You can change or remove your API key at any time using the "Change API Key" button
- The app works entirely in your browser - no backend servers involved

## Build for Production

To build the app for deployment:

```bash
npm run build
```

The built files will be in the `dist` directory and can be deployed to any static hosting service.

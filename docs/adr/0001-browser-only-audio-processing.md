# Process audio in the browser

WaveSlice will process audio entirely in the user's browser and will not upload source audio or generated chunks to a server. The app may load its runtime from the same-origin static host, with no analytics or third-party runtime requests; this keeps audio private and permits static hosting, while accepting browser memory and performance limits instead of server-side processing. The same static build can be served locally or self-hosted through Nginx using Docker Compose; no audio backend is introduced.

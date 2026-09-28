# WaveSlice

WaveSlice turns a user-selected audio recording into ordered chunks for listening, downloading, and later transcription. The source recording and generated audio remain in the user's browser.

## Audio chunks

**Audio source**:
The selected audio file whose timeline is divided into output chunks.
_Avoid_: original, when it is unclear whether this means the source file or an output.

**Chunk**:
An output audio segment representing a contiguous time range from the audio source. Neighboring chunks may contain the same interval when overlap is enabled.
_Avoid_: slice, segment

**Chunk duration**:
The configured maximum duration of each chunk; the final chunk may be shorter.
_Avoid_: chunk size

**Overlap**:
A shared interval of source audio included at the end of one chunk and the beginning of the next.
_Avoid_: gap

**Step**:
The difference between the start timestamps of consecutive chunks. It equals chunk duration minus overlap.
_Avoid_: stride

**Split run**:
One attempt to divide a single audio source into chunks using the current chunk duration and overlap. Completed chunks remain available in the browser session if the run is canceled or a chunk needs retrying.
_Avoid_: batch

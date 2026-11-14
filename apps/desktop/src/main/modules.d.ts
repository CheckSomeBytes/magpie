declare module 'ffmpeg-static' {
  /** Absolute path to the ffmpeg binary for this platform, or null if unsupported. */
  const path: string | null;
  export default path;
}

// The one AudioManager of the page (kept apart from index.ts so the presentation director can import it without
// pulling in the music director, which reads the stores the director feeds).
import { AudioManager } from './manager'

export const audio = new AudioManager()

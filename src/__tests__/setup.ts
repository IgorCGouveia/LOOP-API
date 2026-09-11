import { afterAll } from "vitest";
import { attemptTracker } from "../services/attemptTracker";

// para o sweep interval do AttemptTracker — sem isso o Vitest acusa
// "worker failed to exit gracefully"
afterAll(() => {
    attemptTracker.stop();
});

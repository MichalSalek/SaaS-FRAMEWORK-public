// Ambient types for the test runtime. Lives under src/** so tsc (which only
// includes src/**) picks up the jest-dom matcher augmentation on
// Vitest's `expect` (toBeInTheDocument, toHaveAttribute, ...).
import '@testing-library/jest-dom/vitest';

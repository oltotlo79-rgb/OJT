// Testing Library のマッチャ（`toBeInTheDocument` など）を vitest の `expect` に足す。
// 本プランの UI テストが全面的に使うので、セットアップは1箇所にまとめる。
import '@testing-library/jest-dom/vitest';

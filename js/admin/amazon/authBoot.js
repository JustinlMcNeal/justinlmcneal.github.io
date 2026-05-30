/**
 * Lightweight auth bootstrap — loads before index.js so Connect Amazon
 * is not blocked by the rest of the page module graph.
 */
import { initAmazonAuthStatus } from "./authStatus.js";

window.__kkAmazonAuthStatus = initAmazonAuthStatus();

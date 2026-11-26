/// <reference types="emdash/locals" />

declare namespace Cloudflare {
  interface Env {
    MEDIA: R2Bucket;
    APP_ORIGIN?: string;
    EMDASH_SITE_URL?: string;
    SOURCE_SHA?: string;
  }
}

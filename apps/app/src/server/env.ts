export interface PolarEvent {
  eventId: string
  userId: string
}

export interface Env {
  DB: D1Database
  EMAIL: SendEmail
  POLAR_EVENTS: Queue<PolarEvent>
  APP_ORIGIN: string
  BETTER_AUTH_SECRET: string
  EMAIL_FROM: string
  POLAR_ENVIRONMENT: "sandbox" | "production"
  POLAR_SIGNAL_TOKEN?: string
  POLAR_ACCESS_TOKEN?: string
  POLAR_WEBHOOK_SECRET?: string
  POLAR_MONTHLY_PRODUCT_ID?: string
  POLAR_YEARLY_PRODUCT_ID?: string
  SOURCE_SHA?: string
}

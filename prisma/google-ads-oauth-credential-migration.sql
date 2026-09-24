-- Store the Google Ads refresh token encrypted at application level.
CREATE TABLE IF NOT EXISTS "GoogleAdsOAuthCredential" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "encryptedRefreshToken" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleAdsOAuthCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoogleAdsOAuthCredential" ENABLE ROW LEVEL SECURITY;

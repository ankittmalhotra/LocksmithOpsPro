-- Additive migration for explicit dual-price manual card quotes.
-- Existing rows remain legacy because pricingModel is NULL.
ALTER TABLE "Invoice"
  ADD COLUMN "pricingModel" TEXT,
  ADD COLUMN "nonCardPrice" DOUBLE PRECISION,
  ADD COLUMN "cardPrice" DOUBLE PRECISION,
  ADD COLUMN "cardPriceDifferenceRate" DOUBLE PRECISION,
  ADD COLUMN "acceptedPriceOption" TEXT,
  ADD COLUMN "quoteAcceptanceMethod" TEXT,
  ADD COLUMN "quoteAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "quoteAcceptedById" TEXT,
  ADD COLUMN "quoteAcceptanceEvidence" TEXT;

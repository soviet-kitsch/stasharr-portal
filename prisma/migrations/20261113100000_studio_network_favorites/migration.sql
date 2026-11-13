CREATE TABLE "StudioNetworkFavorite" (
    "provider" "IntegrationType" NOT NULL,
    "studioId" TEXT NOT NULL,

    CONSTRAINT "StudioNetworkFavorite_pkey" PRIMARY KEY ("provider", "studioId")
);

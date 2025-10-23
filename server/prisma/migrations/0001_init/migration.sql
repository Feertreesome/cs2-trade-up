-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "steamTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "local_collection_id" TEXT,
    "last_discovered_count" INTEGER,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "normal_item_count" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skin" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "market_hash_name" TEXT NOT NULL,
    "market_name" TEXT NOT NULL,
    "base_name" TEXT NOT NULL,
    "exterior" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "weapon_type" TEXT,
    "is_stattrak" BOOLEAN NOT NULL DEFAULT false,
    "is_souvenir" BOOLEAN NOT NULL DEFAULT false,
    "sell_listings" INTEGER NOT NULL DEFAULT 0,
    "last_known_price" DOUBLE PRECISION,
    "last_price_at" TIMESTAMP(3),
    "class_id" TEXT,
    "instance_id" TEXT,
    "icon_url" TEXT,
    "tradable" BOOLEAN,
    "float_min" DOUBLE PRECISION,
    "float_max" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Skin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "skin_id" TEXT NOT NULL,
    "price_usd" DOUBLE PRECISION,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collection_steamTag_key" ON "Collection"("steamTag");

-- CreateIndex
CREATE INDEX "Collection_normalizedName_idx" ON "Collection"("normalizedName");

-- CreateIndex
CREATE INDEX "Collection_local_collection_id_idx" ON "Collection"("local_collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "Skin_market_hash_name_key" ON "Skin"("market_hash_name");

-- CreateIndex
CREATE INDEX "Skin_collection_id_rarity_is_stattrak_is_souvenir_idx" ON "Skin"("collection_id", "rarity", "is_stattrak", "is_souvenir");

-- CreateIndex
CREATE INDEX "Skin_rarity_is_stattrak_is_souvenir_idx" ON "Skin"("rarity", "is_stattrak", "is_souvenir");

-- AddForeignKey
ALTER TABLE "Skin" ADD CONSTRAINT "Skin_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceSnapshot" ADD CONSTRAINT "PriceSnapshot_skin_id_fkey" FOREIGN KEY ("skin_id") REFERENCES "Skin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

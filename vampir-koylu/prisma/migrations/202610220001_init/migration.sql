CREATE TABLE "Profile" ("id" TEXT PRIMARY KEY, "sessionHash" TEXT NOT NULL UNIQUE, "nickname" TEXT NOT NULL, "avatar" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Room" ("code" TEXT PRIMARY KEY, "state" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Match" ("id" TEXT PRIMARY KEY, "roomCode" TEXT NOT NULL, "result" TEXT NOT NULL, "summary" JSONB NOT NULL, "endedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Participation" ("matchId" TEXT NOT NULL REFERENCES "Match"("id") ON DELETE CASCADE, "profileId" TEXT NOT NULL, "outcome" TEXT NOT NULL, PRIMARY KEY ("matchId", "profileId"));
CREATE INDEX "Participation_profileId_idx" ON "Participation"("profileId");

export const hasDatabaseConnection = (): boolean => {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.trim().length > 0;
};

export const ensureDatabaseConnection = (): void => {
  if (!hasDatabaseConnection()) {
    throw new Error("DATABASE_URL environment variable is not configured");
  }
};

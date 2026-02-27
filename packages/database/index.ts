export interface Database {
  query(sql: string, params?: any[]): Promise<any>
}

let dbInstance: Database

export function setDatabase(db: Database) {
  dbInstance = db
}

export function getDb(): Database {
  if (!dbInstance) throw new Error("Database not initialized")
  return dbInstance
}
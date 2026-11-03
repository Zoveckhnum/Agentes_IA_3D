CREATE SCHEMA app AUTHORIZATION dbo;
GO
CREATE TABLE app.Documents (
  Path nvarchar(450) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  CollectionPath nvarchar(400) COLLATE Latin1_General_100_BIN2 NOT NULL,
  DocumentId nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  Payload nvarchar(max) NOT NULL CHECK (ISJSON(Payload) = 1),
  UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_Documents_UpdatedAt DEFAULT SYSUTCDATETIME(),
  Revision rowversion NOT NULL
);
CREATE INDEX IX_Documents_Collection ON app.Documents(CollectionPath, DocumentId);
CREATE TABLE app.Accounts (
  Uid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  Email nvarchar(320) NOT NULL,
  EmailNormalized AS LOWER(Email) PERSISTED,
  PasswordDigest varchar(300) NULL,
  Disabled bit NOT NULL DEFAULT 0,
  MustChangePassword bit NOT NULL DEFAULT 1,
  EmailVerified bit NOT NULL DEFAULT 0,
  DisplayName nvarchar(200) NULL,
  PhotoUrl nvarchar(2048) NULL,
  CredentialVersion int NOT NULL DEFAULT 1,
  FailedLogins int NOT NULL DEFAULT 0,
  LockedUntil datetime2(7) NULL,
  CreatedAt datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE UNIQUE INDEX UX_Accounts_Email ON app.Accounts(EmailNormalized);
CREATE TABLE app.Sessions (
  TokenHash char(64) NOT NULL PRIMARY KEY,
  Uid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES app.Accounts(Uid),
  CredentialVersion int NOT NULL,
  ExpiresAt datetime2(7) NOT NULL,
  CreatedAt datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Sessions_Expiry ON app.Sessions(ExpiresAt);
CREATE TABLE app.Commits (
  CommitId uniqueidentifier NOT NULL PRIMARY KEY,
  Actor nvarchar(128) NOT NULL,
  RequestHash char(64) NOT NULL,
  CreatedAt datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Commits_Created ON app.Commits(CreatedAt);
CREATE TABLE app.AuditLog (
  Id bigint IDENTITY NOT NULL PRIMARY KEY,
  Actor nvarchar(128) NOT NULL,
  Action varchar(32) NOT NULL,
  DocumentPath nvarchar(450) NULL,
  CreatedAt datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_AuditLog_Created ON app.AuditLog(CreatedAt);
CREATE TABLE app.MigrationImports (
  SourceHash char(64) NOT NULL PRIMARY KEY,
  DocumentCount int NOT NULL,
  AccountCount int NOT NULL,
  VerifiedAt datetime2(7) NOT NULL DEFAULT SYSUTCDATETIME()
);

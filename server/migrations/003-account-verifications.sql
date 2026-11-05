CREATE TABLE app.AccountVerifications (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  Uid nvarchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES app.Accounts(Uid),
  Purpose varchar(16) NOT NULL CHECK (Purpose IN ('email','password')),
  TargetEmail nvarchar(320) NOT NULL,
  CredentialVersion int NOT NULL,
  CodeHash char(64) NOT NULL,
  CurrentCodeHash char(64) NULL,
  Attempts int NOT NULL DEFAULT 0,
  Sent bit NOT NULL DEFAULT 0,
  Used bit NOT NULL DEFAULT 0,
  CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  ExpiresAt datetime2 NOT NULL
);
CREATE INDEX IX_AccountVerifications_User ON app.AccountVerifications(Uid, CreatedAt);

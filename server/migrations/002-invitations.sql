CREATE TABLE app.InvitationTokens (
  Email nvarchar(320) NOT NULL PRIMARY KEY,
  TokenHash char(64) NOT NULL,
  Role varchar(16) NOT NULL CHECK (Role IN ('admin','empleado','pending')),
  CreatedBy nvarchar(128) NOT NULL,
  ExpiresAt datetime2(7) NOT NULL
);

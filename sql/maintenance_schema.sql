/*
Wilson Maintenance Portal - SQL Server bootstrap schema v0.2
Last updated: 2026-08-21

Purpose
-------
Customer enrollment, appliance/HVAC subscriptions, scheduled maintenance
intervals, Stripe references, filters, appliance health reports, custom estate
quotes, NetSuite integration state, and audit history.

This is a non-destructive starter script: it creates missing objects and seeds
current plan configuration. It does not drop existing data. If a v0.1 version
of these tables has already been used with real data, create and test a formal
migration before applying the new model in production.

Security
--------
Store Stripe references only. Never store full card numbers, CVC, secret keys,
or unrestricted provider payloads. Use a least-privilege SQL login for the app.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/* -------------------------------------------------------------------------
   Schema version
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceSchemaVersions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceSchemaVersions (
        SchemaVersionId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceSchemaVersions PRIMARY KEY,
        VersionNumber NVARCHAR(30) NOT NULL,
        AppliedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceSchemaVersions_AppliedAt DEFAULT SYSUTCDATETIME(),
        Notes NVARCHAR(1000) NULL
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM dbo.MaintenanceSchemaVersions WHERE VersionNumber = '0.2'
)
BEGIN
    INSERT INTO dbo.MaintenanceSchemaVersions (VersionNumber, Notes)
    VALUES ('0.2', 'Maintenance portal customer enrollment, interval billing, filters, reports, and custom quotes.');
END;
GO

/* -------------------------------------------------------------------------
   Households and contacts
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceHouseholds', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHouseholds (
        HouseholdId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHouseholds PRIMARY KEY,
        HouseholdReference NVARCHAR(40) NULL,
        DisplayName NVARCHAR(255) NOT NULL,
        Address1 NVARCHAR(255) NOT NULL,
        Address2 NVARCHAR(255) NULL,
        City NVARCHAR(100) NOT NULL,
        StateCode NVARCHAR(10) NOT NULL,
        PostalCode NVARCHAR(20) NOT NULL,
        PreferredContact NVARCHAR(30) NULL,
        PreferredTiming NVARCHAR(150) NULL,
        AccessNotes NVARCHAR(MAX) NULL,
        ServiceAreaStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceHouseholds_ServiceArea DEFAULT ('Needs review'),
        EpassCustomerCode NVARCHAR(100) NULL,
        NetSuiteCustomerId NVARCHAR(100) NULL,
        HouseholdStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceHouseholds_Status DEFAULT ('Active'),
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceHouseholds_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceHouseholds_UpdatedAt DEFAULT SYSUTCDATETIME(),
        VersionStamp ROWVERSION
    );

    CREATE UNIQUE INDEX UX_MaintenanceHouseholds_Reference
        ON dbo.MaintenanceHouseholds(HouseholdReference)
        WHERE HouseholdReference IS NOT NULL;

    CREATE INDEX IX_MaintenanceHouseholds_Name
        ON dbo.MaintenanceHouseholds(DisplayName);

    CREATE INDEX IX_MaintenanceHouseholds_Address
        ON dbo.MaintenanceHouseholds(PostalCode, Address1);
END;
GO

IF OBJECT_ID('dbo.MaintenanceContacts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceContacts (
        ContactId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceContacts PRIMARY KEY,
        HouseholdId INT NOT NULL,
        ContactRole NVARCHAR(50) NULL,
        FirstName NVARCHAR(100) NULL,
        LastName NVARCHAR(100) NULL,
        CompanyName NVARCHAR(150) NULL,
        Email NVARCHAR(255) NULL,
        Phone NVARCHAR(50) NULL,
        PreferredContact NVARCHAR(30) NULL,
        IsPrimary BIT NOT NULL
            CONSTRAINT DF_MaintenanceContacts_IsPrimary DEFAULT (0),
        ContactStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceContacts_Status DEFAULT ('Active'),
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceContacts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceContacts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenanceContacts_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId)
    );

    CREATE INDEX IX_MaintenanceContacts_Household
        ON dbo.MaintenanceContacts(HouseholdId, IsPrimary, ContactStatus);
END;
GO

/* -------------------------------------------------------------------------
   Plan configuration
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenancePlans', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenancePlans (
        PlanId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenancePlans PRIMARY KEY,
        PlanCode NVARCHAR(50) NOT NULL
            CONSTRAINT UQ_MaintenancePlans_PlanCode UNIQUE,
        PlanCategory NVARCHAR(30) NOT NULL,
        PlanName NVARCHAR(150) NOT NULL,
        Description NVARCHAR(1000) NULL,
        AnnualPrice DECIMAL(12,2) NULL,
        PerAssetAnnualPrice DECIMAL(12,2) NULL,
        PerVisitPrice DECIMAL(12,2) NULL,
        PricePerSystemAnnual DECIMAL(12,2) NULL,
        VisitsPerYear DECIMAL(6,2) NULL,
        DefaultAssetVisitsPerYear DECIMAL(6,2) NULL,
        IsWholeHome BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_IsWholeHome DEFAULT (0),
        IncludedAssetCount INT NULL,
        AdditionalAssetPrice DECIMAL(12,2) NULL,
        CustomReviewAssetCount INT NULL,
        IncludesCleaning BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_Cleaning DEFAULT (0),
        IncludesPriorityService BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_Priority DEFAULT (0),
        IncludesFilterManagement BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_FilterManagement DEFAULT (0),
        IncludesFilterMaterials BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_FilterMaterials DEFAULT (0),
        IncludesHealthReports BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_Reports DEFAULT (0),
        DefaultAutoRenew BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_AutoRenew DEFAULT (1),
        ChargeTimingCode NVARCHAR(40) NOT NULL
            CONSTRAINT DF_MaintenancePlans_ChargeTiming DEFAULT ('SCHEDULED_INTERVAL'),
        TermsVersion NVARCHAR(50) NULL,
        PricingVersion NVARCHAR(50) NULL,
        RulesJson NVARCHAR(MAX) NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_MaintenancePlans_IsActive DEFAULT (1),
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenancePlans_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenancePlans_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

MERGE dbo.MaintenancePlans AS target
USING (VALUES
    (
        'APPLIANCE_SINGLE', 'Appliance', 'Per Appliance',
        'One annual visit for an individual non-IMUC household appliance.',
        NULL, 149.95, NULL, NULL, 1.00, 1.00,
        0, NULL, NULL, NULL,
        0, 0, 0, 0, 0, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"priceBasis":"perAssetPerYear","excludes":["IMUC","HVAC"],"filtersIncluded":false,"disassemblyIncluded":false}'
    ),
    (
        'IMUC_PER_VISIT', 'Appliance', 'IMUC Icemaker',
        'Icemaker cleaning and maintenance priced per visit; two annual visits are selected by default.',
        NULL, NULL, 249.95, NULL, NULL, 2.00,
        0, NULL, NULL, NULL,
        0, 0, 0, 0, 0, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"priceBasis":"perVisit","recommendedVisitsPerYear":2,"customerMaySelectOne":true}'
    ),
    (
        'ESTATE_ANNUAL', 'Appliance', 'Estate Annual',
        'One coordinated whole-home appliance maintenance visit each year.',
        1195.00, NULL, NULL, NULL, 1.00, 1.00,
        1, 15, 60.00, 26,
        0, 0, 0, 0, 0, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"autoCrossoverEligible":true,"secondImucVisitCents":24995,"filtersIncluded":false}'
    ),
    (
        'ESTATE_PREFERRED', 'Appliance', 'Estate Preferred',
        'Two coordinated whole-home appliance maintenance visits each year.',
        1995.00, NULL, NULL, NULL, 2.00, 2.00,
        1, 15, 100.00, 26,
        0, 0, 0, 0, 0, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"twiceYearlyImucIncluded":true,"filtersIncluded":false}'
    ),
    (
        'ESTATE_CONCIERGE', 'Appliance', 'Estate Concierge',
        'Hands-off appliance portfolio management with two visits, filter coverage, priority service, and appliance health reports.',
        2995.00, NULL, NULL, NULL, 2.00, 2.00,
        1, 15, 150.00, 26,
        1, 1, 1, 1, 1, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"twiceYearlyImucIncluded":true,"includedFilters":["refrigerator water","refrigerator air / food preservation","freezer water","IMUC water"],"scopeExclusions":["BBQ / grill cleaning","disassembly unless separately approved"]}'
    ),
    (
        'HVAC_MAINTENANCE', 'HVAC', 'Wilson AC Maintenance',
        'Two maintenance visits per HVAC system each year.',
        NULL, NULL, NULL, 200.00, 2.00, 2.00,
        0, NULL, NULL, NULL,
        0, 0, 0, 0, 0, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"priceBasis":"perSystemPerYear","contactTiming":"spring and fall, weather permitting"}'
    ),
    (
        'HVAC_FILTER_MANAGEMENT', 'HVAC', 'Wilson AC Maintenance + Filters',
        'Two maintenance visits plus filter inventory, sourcing, and replacement management.',
        NULL, NULL, NULL, 400.00, 2.00, 2.00,
        0, NULL, NULL, NULL,
        0, 0, 1, 0, 0, 1, 'SCHEDULED_INTERVAL',
        'maintenance-2026-08-21', '2026-08-21',
        N'{"priceBasis":"perSystemPerYear","filterCoverage":"managed; material billed separately","contactTiming":"spring and fall, weather permitting"}'
    )
) AS source (
    PlanCode, PlanCategory, PlanName, Description,
    AnnualPrice, PerAssetAnnualPrice, PerVisitPrice, PricePerSystemAnnual,
    VisitsPerYear, DefaultAssetVisitsPerYear,
    IsWholeHome, IncludedAssetCount, AdditionalAssetPrice, CustomReviewAssetCount,
    IncludesCleaning, IncludesPriorityService, IncludesFilterManagement,
    IncludesFilterMaterials, IncludesHealthReports, DefaultAutoRenew,
    ChargeTimingCode, TermsVersion, PricingVersion, RulesJson
)
ON target.PlanCode = source.PlanCode
WHEN MATCHED THEN UPDATE SET
    PlanCategory = source.PlanCategory,
    PlanName = source.PlanName,
    Description = source.Description,
    AnnualPrice = source.AnnualPrice,
    PerAssetAnnualPrice = source.PerAssetAnnualPrice,
    PerVisitPrice = source.PerVisitPrice,
    PricePerSystemAnnual = source.PricePerSystemAnnual,
    VisitsPerYear = source.VisitsPerYear,
    DefaultAssetVisitsPerYear = source.DefaultAssetVisitsPerYear,
    IsWholeHome = source.IsWholeHome,
    IncludedAssetCount = source.IncludedAssetCount,
    AdditionalAssetPrice = source.AdditionalAssetPrice,
    CustomReviewAssetCount = source.CustomReviewAssetCount,
    IncludesCleaning = source.IncludesCleaning,
    IncludesPriorityService = source.IncludesPriorityService,
    IncludesFilterManagement = source.IncludesFilterManagement,
    IncludesFilterMaterials = source.IncludesFilterMaterials,
    IncludesHealthReports = source.IncludesHealthReports,
    DefaultAutoRenew = source.DefaultAutoRenew,
    ChargeTimingCode = source.ChargeTimingCode,
    TermsVersion = source.TermsVersion,
    PricingVersion = source.PricingVersion,
    RulesJson = source.RulesJson,
    IsActive = 1,
    UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (
    PlanCode, PlanCategory, PlanName, Description,
    AnnualPrice, PerAssetAnnualPrice, PerVisitPrice, PricePerSystemAnnual,
    VisitsPerYear, DefaultAssetVisitsPerYear,
    IsWholeHome, IncludedAssetCount, AdditionalAssetPrice, CustomReviewAssetCount,
    IncludesCleaning, IncludesPriorityService, IncludesFilterManagement,
    IncludesFilterMaterials, IncludesHealthReports, DefaultAutoRenew,
    ChargeTimingCode, TermsVersion, PricingVersion, RulesJson
) VALUES (
    source.PlanCode, source.PlanCategory, source.PlanName, source.Description,
    source.AnnualPrice, source.PerAssetAnnualPrice, source.PerVisitPrice, source.PricePerSystemAnnual,
    source.VisitsPerYear, source.DefaultAssetVisitsPerYear,
    source.IsWholeHome, source.IncludedAssetCount, source.AdditionalAssetPrice, source.CustomReviewAssetCount,
    source.IncludesCleaning, source.IncludesPriorityService, source.IncludesFilterManagement,
    source.IncludesFilterMaterials, source.IncludesHealthReports, source.DefaultAutoRenew,
    source.ChargeTimingCode, source.TermsVersion, source.PricingVersion, source.RulesJson
);
GO

/* -------------------------------------------------------------------------
   Equipment and payment profiles
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceAssets', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceAssets (
        AssetId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceAssets PRIMARY KEY,
        HouseholdId INT NOT NULL,
        AssetCategory NVARCHAR(30) NOT NULL,
        AssetTypeCode NVARCHAR(50) NOT NULL,
        AssetTypeName NVARCHAR(100) NOT NULL,
        PricingClass NVARCHAR(30) NULL,
        Brand NVARCHAR(100) NULL,
        Model NVARCHAR(100) NULL,
        SerialNumber NVARCHAR(150) NULL,
        LocationName NVARCHAR(150) NULL,
        InstallYear SMALLINT NULL,
        CheckpointSetCode NVARCHAR(50) NULL,
        RecommendedVisitsPerYear DECIMAL(6,2) NULL,
        SelectedVisitsPerYear DECIMAL(6,2) NULL,
        FilterProfileJson NVARCHAR(MAX) NULL,
        EquipmentMetadataJson NVARCHAR(MAX) NULL,
        NetSuiteAssetId NVARCHAR(100) NULL,
        AssetStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceAssets_Status DEFAULT ('Active'),
        SortOrder INT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceAssets_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceAssets_UpdatedAt DEFAULT SYSUTCDATETIME(),
        VersionStamp ROWVERSION,
        CONSTRAINT FK_MaintenanceAssets_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId)
    );

    CREATE INDEX IX_MaintenanceAssets_Household
        ON dbo.MaintenanceAssets(HouseholdId, AssetStatus, SortOrder);

    CREATE INDEX IX_MaintenanceAssets_Model
        ON dbo.MaintenanceAssets(Model);
END;
GO

IF OBJECT_ID('dbo.MaintenancePaymentProfiles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenancePaymentProfiles (
        PaymentProfileId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenancePaymentProfiles PRIMARY KEY,
        HouseholdId INT NOT NULL,
        ProviderName NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenancePaymentProfiles_Provider DEFAULT ('Stripe'),
        StripeCustomerId NVARCHAR(100) NULL,
        StripePaymentMethodId NVARCHAR(100) NULL,
        SetupIntentId NVARCHAR(100) NULL,
        CardBrand NVARCHAR(30) NULL,
        CardLast4 CHAR(4) NULL,
        ExpMonth TINYINT NULL,
        ExpYear SMALLINT NULL,
        PaymentProfileStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenancePaymentProfiles_Status DEFAULT ('Pending setup'),
        IsDefault BIT NOT NULL
            CONSTRAINT DF_MaintenancePaymentProfiles_Default DEFAULT (1),
        LastVerifiedAt DATETIME2 NULL,
        LastProviderErrorCode NVARCHAR(100) NULL,
        LastProviderErrorMessage NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenancePaymentProfiles_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenancePaymentProfiles_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenancePaymentProfiles_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId)
    );

    CREATE INDEX IX_MaintenancePaymentProfiles_Household
        ON dbo.MaintenancePaymentProfiles(HouseholdId, IsDefault, PaymentProfileStatus);
END;
GO

/* -------------------------------------------------------------------------
   Subscriptions and covered assets
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceSubscriptions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceSubscriptions (
        SubscriptionId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceSubscriptions PRIMARY KEY,
        HouseholdId INT NOT NULL,
        PlanId INT NOT NULL,
        PaymentProfileId INT NULL,
        SubscriptionStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_Status DEFAULT ('Pending review'),
        AnnualAmount DECIMAL(12,2) NOT NULL,
        BaseAmount DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_BaseAmount DEFAULT (0),
        AssetCountAtEnrollment INT NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_AssetCount DEFAULT (0),
        IncludedAssetCount INT NULL,
        AdditionalAssetCount INT NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_AdditionalCount DEFAULT (0),
        AdditionalAssetRate DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_AdditionalRate DEFAULT (0),
        AdditionalAssetAmount DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_AdditionalAmount DEFAULT (0),
        ImucAddOnCount INT NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_ImucCount DEFAULT (0),
        ImucAddOnRate DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_ImucRate DEFAULT (0),
        ImucAddOnAmount DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_ImucAmount DEFAULT (0),
        CustomReviewRequired BIT NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_CustomReview DEFAULT (0),
        StartDate DATE NULL,
        PlanYearEndDate DATE NULL,
        RenewalDate DATE NULL,
        PreferredTiming NVARCHAR(150) NULL,
        AutoRenew BIT NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_AutoRenew DEFAULT (1),
        ChargeTimingCode NVARCHAR(40) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_ChargeTiming DEFAULT ('SCHEDULED_INTERVAL'),
        PricingVersion NVARCHAR(50) NULL,
        TermsVersion NVARCHAR(50) NULL,
        EnrollmentSource NVARCHAR(50) NULL,
        EnrollmentIdempotencyKey NVARCHAR(120) NULL,
        CustomerAcceptedTermsAt DATETIME2 NULL,
        CustomerAuthorizedScheduledChargesAt DATETIME2 NULL,
        CancellationRequestedAt DATETIME2 NULL,
        CancellationEffectiveDate DATE NULL,
        CancellationReason NVARCHAR(500) NULL,
        InternalNotes NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptions_UpdatedAt DEFAULT SYSUTCDATETIME(),
        VersionStamp ROWVERSION,
        CONSTRAINT FK_MaintenanceSubscriptions_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId),
        CONSTRAINT FK_MaintenanceSubscriptions_Plans
            FOREIGN KEY (PlanId) REFERENCES dbo.MaintenancePlans(PlanId),
        CONSTRAINT FK_MaintenanceSubscriptions_PaymentProfiles
            FOREIGN KEY (PaymentProfileId) REFERENCES dbo.MaintenancePaymentProfiles(PaymentProfileId)
    );

    CREATE INDEX IX_MaintenanceSubscriptions_Household
        ON dbo.MaintenanceSubscriptions(HouseholdId, SubscriptionStatus);

    CREATE INDEX IX_MaintenanceSubscriptions_Renewal
        ON dbo.MaintenanceSubscriptions(RenewalDate, SubscriptionStatus);

    CREATE UNIQUE INDEX UX_MaintenanceSubscriptions_EnrollmentKey
        ON dbo.MaintenanceSubscriptions(EnrollmentIdempotencyKey)
        WHERE EnrollmentIdempotencyKey IS NOT NULL;
END;
GO

IF OBJECT_ID('dbo.MaintenanceSubscriptionAssets', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceSubscriptionAssets (
        SubscriptionAssetId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceSubscriptionAssets PRIMARY KEY,
        SubscriptionId INT NOT NULL,
        AssetId INT NOT NULL,
        CoverageStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptionAssets_Coverage DEFAULT ('Covered'),
        SelectedVisitsPerYear DECIMAL(6,2) NULL,
        UnitAnnualAmount DECIMAL(12,2) NULL,
        UnitPerVisitAmount DECIMAL(12,2) NULL,
        CoverageSnapshotJson NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceSubscriptionAssets_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenanceSubscriptionAssets_Subscriptions
            FOREIGN KEY (SubscriptionId) REFERENCES dbo.MaintenanceSubscriptions(SubscriptionId),
        CONSTRAINT FK_MaintenanceSubscriptionAssets_Assets
            FOREIGN KEY (AssetId) REFERENCES dbo.MaintenanceAssets(AssetId),
        CONSTRAINT UQ_MaintenanceSubscriptionAssets UNIQUE (SubscriptionId, AssetId)
    );

    CREATE INDEX IX_MaintenanceSubscriptionAssets_Asset
        ON dbo.MaintenanceSubscriptionAssets(AssetId, CoverageStatus);
END;
GO

/* -------------------------------------------------------------------------
   Scheduled maintenance intervals / visits
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceVisits', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceVisits (
        VisitId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceVisits PRIMARY KEY,
        SubscriptionId INT NOT NULL,
        HouseholdId INT NOT NULL,
        PlanYearStartDate DATE NULL,
        PlanYearEndDate DATE NULL,
        IntervalNumber INT NULL,
        IntervalKey NVARCHAR(120) NULL,
        DueDate DATE NOT NULL,
        DueLabel NVARCHAR(150) NULL,
        AssetScope NVARCHAR(500) NULL,
        VisitStatus NVARCHAR(40) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_Status DEFAULT ('Upcoming'),
        ChargeType NVARCHAR(40) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_ChargeType DEFAULT ('ANNUAL_PLAN'),
        ChargeEligibilityStatus NVARCHAR(40) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_ChargeEligibility DEFAULT ('Needs review'),
        PaymentStatus NVARCHAR(40) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_PaymentStatus DEFAULT ('Not reviewed'),
        AmountToCharge DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_Amount DEFAULT (0),
        PaymentIntentId NVARCHAR(100) NULL,
        PaymentIdempotencyKey NVARCHAR(150) NULL,
        PaymentAttemptCount INT NOT NULL
            CONSTRAINT DF_MaintenanceVisits_PaymentAttempts DEFAULT (0),
        ChargedAt DATETIME2 NULL,
        ServiceOrderSystem NVARCHAR(30) NULL,
        ServiceOrderId NVARCHAR(100) NULL,
        ServiceOrderNumber NVARCHAR(100) NULL,
        ServiceOrderStatus NVARCHAR(50) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_ServiceOrder DEFAULT ('Not created'),
        ServiceOrderIdempotencyKey NVARCHAR(150) NULL,
        ScheduledStartAt DATETIME2 NULL,
        CompletedAt DATETIME2 NULL,
        ReportRequired BIT NOT NULL
            CONSTRAINT DF_MaintenanceVisits_ReportRequired DEFAULT (0),
        ReportStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceVisits_ReportStatus DEFAULT ('Not started'),
        FilterReviewRequired BIT NOT NULL
            CONSTRAINT DF_MaintenanceVisits_FilterReview DEFAULT (0),
        DispatcherNotes NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceVisits_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceVisits_UpdatedAt DEFAULT SYSUTCDATETIME(),
        VersionStamp ROWVERSION,
        CONSTRAINT FK_MaintenanceVisits_Subscriptions
            FOREIGN KEY (SubscriptionId) REFERENCES dbo.MaintenanceSubscriptions(SubscriptionId),
        CONSTRAINT FK_MaintenanceVisits_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId)
    );

    CREATE UNIQUE INDEX UX_MaintenanceVisits_IntervalKey
        ON dbo.MaintenanceVisits(IntervalKey)
        WHERE IntervalKey IS NOT NULL;

    CREATE INDEX IX_MaintenanceVisits_DueQueue
        ON dbo.MaintenanceVisits(DueDate, VisitStatus, ChargeEligibilityStatus);

    CREATE INDEX IX_MaintenanceVisits_Household
        ON dbo.MaintenanceVisits(HouseholdId, DueDate);
END;
GO

IF OBJECT_ID('dbo.MaintenanceVisitAssets', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceVisitAssets (
        VisitAssetId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceVisitAssets PRIMARY KEY,
        VisitId INT NOT NULL,
        AssetId INT NOT NULL,
        VisitAssetStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceVisitAssets_Status DEFAULT ('Planned'),
        TechnicianNotes NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceVisitAssets_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenanceVisitAssets_Visits
            FOREIGN KEY (VisitId) REFERENCES dbo.MaintenanceVisits(VisitId),
        CONSTRAINT FK_MaintenanceVisitAssets_Assets
            FOREIGN KEY (AssetId) REFERENCES dbo.MaintenanceAssets(AssetId),
        CONSTRAINT UQ_MaintenanceVisitAssets UNIQUE (VisitId, AssetId)
    );
END;
GO

/* -------------------------------------------------------------------------
   Filters and consumables
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceFilters', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceFilters (
        FilterId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceFilters PRIMARY KEY,
        HouseholdId INT NOT NULL,
        SubscriptionId INT NULL,
        AssetId INT NULL,
        FilterTypeCode NVARCHAR(60) NULL,
        FilterType NVARCHAR(150) NOT NULL,
        PartNumber NVARCHAR(100) NULL,
        Quantity INT NOT NULL
            CONSTRAINT DF_MaintenanceFilters_Quantity DEFAULT (1),
        FilterLocation NVARCHAR(200) NULL,
        IntervalMonths INT NULL,
        LastChangedOn DATE NULL,
        LastChangedVisitId INT NULL,
        NextDueOn DATE NULL,
        FilterStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceFilters_Status DEFAULT ('Setup needed'),
        CoverageCode NVARCHAR(50) NOT NULL
            CONSTRAINT DF_MaintenanceFilters_Coverage DEFAULT ('TRACK_ONLY'),
        SupplySource NVARCHAR(100) NULL,
        UnitCost DECIMAL(12,2) NULL,
        CustomerCharge DECIMAL(12,2) NULL,
        Notes NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceFilters_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceFilters_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_MaintenanceFilters_Coverage CHECK (
            CoverageCode IN ('INCLUDED', 'MANAGED_BILLED_SEPARATELY', 'TRACK_ONLY')
        ),
        CONSTRAINT FK_MaintenanceFilters_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId),
        CONSTRAINT FK_MaintenanceFilters_Subscriptions
            FOREIGN KEY (SubscriptionId) REFERENCES dbo.MaintenanceSubscriptions(SubscriptionId),
        CONSTRAINT FK_MaintenanceFilters_Assets
            FOREIGN KEY (AssetId) REFERENCES dbo.MaintenanceAssets(AssetId),
        CONSTRAINT FK_MaintenanceFilters_Visits
            FOREIGN KEY (LastChangedVisitId) REFERENCES dbo.MaintenanceVisits(VisitId)
    );

    CREATE INDEX IX_MaintenanceFilters_Due
        ON dbo.MaintenanceFilters(NextDueOn, FilterStatus, CoverageCode);

    CREATE INDEX IX_MaintenanceFilters_Household
        ON dbo.MaintenanceFilters(HouseholdId, AssetId);
END;
GO

/* -------------------------------------------------------------------------
   Appliance health reports
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceHealthReports', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReports (
        HealthReportId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReports PRIMARY KEY,
        HouseholdId INT NOT NULL,
        AssetId INT NOT NULL,
        VisitId INT NULL,
        ReportType NVARCHAR(100) NOT NULL
            CONSTRAINT DF_MaintenanceHealthReports_Type DEFAULT ('Appliance Health Report'),
        ReportReference NVARCHAR(100) NULL,
        ScoreTemplateCode NVARCHAR(100) NULL,
        ScoreTemplateVersion INT NULL,
        ReportInformationVersion NVARCHAR(50) NULL,
        RevisionNumber INT NOT NULL
            CONSTRAINT DF_MaintenanceHealthReports_Revision DEFAULT (1),
        InspectionDate DATE NOT NULL,
        NextDueOn DATE NULL,
        TechnicianName NVARCHAR(150) NOT NULL,
        HealthScore INT NOT NULL,
        GradeLabel NVARCHAR(10) NULL,
        ConditionLabel NVARCHAR(50) NOT NULL,
        TechnicianSummary NVARCHAR(MAX) NULL,
        Recommendations NVARCHAR(MAX) NULL,
        ServiceSummary NVARCHAR(MAX) NULL,
        FilterPart NVARCHAR(150) NULL,
        FilterAction NVARCHAR(150) NULL,
        PhotoCount INT NOT NULL
            CONSTRAINT DF_MaintenanceHealthReports_PhotoCount DEFAULT (0),
        ReportStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceHealthReports_Status DEFAULT ('Draft'),
        PdfStorageKey NVARCHAR(500) NULL,
        PublicShareTokenHash NVARCHAR(200) NULL,
        FinalizedAt DATETIME2 NULL,
        FinalizedByUserId NVARCHAR(100) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceHealthReports_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceHealthReports_UpdatedAt DEFAULT SYSUTCDATETIME(),
        VersionStamp ROWVERSION,
        CONSTRAINT CK_MaintenanceHealthReports_Score
            CHECK (HealthScore BETWEEN 0 AND 100),
        CONSTRAINT FK_MaintenanceHealthReports_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId),
        CONSTRAINT FK_MaintenanceHealthReports_Assets
            FOREIGN KEY (AssetId) REFERENCES dbo.MaintenanceAssets(AssetId),
        CONSTRAINT FK_MaintenanceHealthReports_Visits
            FOREIGN KEY (VisitId) REFERENCES dbo.MaintenanceVisits(VisitId)
    );

    CREATE INDEX IX_MaintenanceHealthReports_Household
        ON dbo.MaintenanceHealthReports(HouseholdId, InspectionDate DESC);

    CREATE INDEX IX_MaintenanceHealthReports_Asset
        ON dbo.MaintenanceHealthReports(AssetId, InspectionDate DESC);
END;
GO

IF OBJECT_ID('dbo.MaintenanceHealthReportMeasurements', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReportMeasurements (
        HealthReportMeasurementId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReportMeasurements PRIMARY KEY,
        HealthReportId INT NOT NULL,
        MeasurementCode NVARCHAR(100) NULL,
        MeasurementLabel NVARCHAR(255) NOT NULL,
        ObservedValue NVARCHAR(100) NULL,
        UnitLabel NVARCHAR(50) NULL,
        TargetText NVARCHAR(255) NULL,
        ResultStatus NVARCHAR(30) NULL,
        Notes NVARCHAR(MAX) NULL,
        SortOrder INT NULL,
        CONSTRAINT FK_MaintenanceHealthReportMeasurements_Reports
            FOREIGN KEY (HealthReportId)
            REFERENCES dbo.MaintenanceHealthReports(HealthReportId) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID('dbo.MaintenanceHealthReportItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReportItems (
        HealthReportItemId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReportItems PRIMARY KEY,
        HealthReportId INT NOT NULL,
        CheckpointCode NVARCHAR(100) NULL,
        CategoryName NVARCHAR(150) NULL,
        CheckpointName NVARCHAR(255) NOT NULL,
        WeightValue DECIMAL(10,4) NULL,
        Rating TINYINT NULL,
        StatusLabel NVARCHAR(30) NULL,
        Notes NVARCHAR(MAX) NULL,
        SortOrder INT NULL,
        CONSTRAINT CK_MaintenanceHealthReportItems_Rating
            CHECK (Rating IS NULL OR Rating BETWEEN 1 AND 5),
        CONSTRAINT FK_MaintenanceHealthReportItems_Reports
            FOREIGN KEY (HealthReportId)
            REFERENCES dbo.MaintenanceHealthReports(HealthReportId) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID('dbo.MaintenanceHealthReportCategoryLosses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReportCategoryLosses (
        HealthReportCategoryLossId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReportCategoryLosses PRIMARY KEY,
        HealthReportId INT NOT NULL,
        CategoryName NVARCHAR(150) NOT NULL,
        PointsDeducted DECIMAL(10,2) NOT NULL,
        Explanation NVARCHAR(1000) NULL,
        SortOrder INT NULL,
        CONSTRAINT FK_MaintenanceHealthReportCategoryLosses_Reports
            FOREIGN KEY (HealthReportId)
            REFERENCES dbo.MaintenanceHealthReports(HealthReportId) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID('dbo.MaintenanceHealthReportTasks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReportTasks (
        HealthReportTaskId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReportTasks PRIMARY KEY,
        HealthReportId INT NOT NULL,
        TaskCode NVARCHAR(100) NULL,
        TaskName NVARCHAR(255) NOT NULL,
        Completed BIT NOT NULL
            CONSTRAINT DF_MaintenanceHealthReportTasks_Completed DEFAULT (1),
        Notes NVARCHAR(MAX) NULL,
        SortOrder INT NULL,
        CONSTRAINT FK_MaintenanceHealthReportTasks_Reports
            FOREIGN KEY (HealthReportId)
            REFERENCES dbo.MaintenanceHealthReports(HealthReportId) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID('dbo.MaintenanceHealthReportCorrectiveMeasures', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReportCorrectiveMeasures (
        HealthReportCorrectiveMeasureId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReportCorrectiveMeasures PRIMARY KEY,
        HealthReportId INT NOT NULL,
        MeasureText NVARCHAR(1000) NOT NULL,
        MeasureStatus NVARCHAR(30) NULL,
        RelatedCheckpointCode NVARCHAR(100) NULL,
        SortOrder INT NULL,
        CONSTRAINT FK_MaintenanceHealthReportCorrectiveMeasures_Reports
            FOREIGN KEY (HealthReportId)
            REFERENCES dbo.MaintenanceHealthReports(HealthReportId) ON DELETE CASCADE
    );
END;
GO

IF OBJECT_ID('dbo.MaintenanceHealthReportPhotos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceHealthReportPhotos (
        HealthReportPhotoId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceHealthReportPhotos PRIMARY KEY,
        HealthReportId INT NOT NULL,
        StorageProvider NVARCHAR(50) NOT NULL,
        StorageKey NVARCHAR(500) NOT NULL,
        ContentType NVARCHAR(100) NULL,
        FileSizeBytes BIGINT NULL,
        Caption NVARCHAR(500) NULL,
        PhotoType NVARCHAR(100) NULL,
        SortOrder INT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceHealthReportPhotos_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenanceHealthReportPhotos_Reports
            FOREIGN KEY (HealthReportId)
            REFERENCES dbo.MaintenanceHealthReports(HealthReportId) ON DELETE CASCADE
    );
END;
GO

/* -------------------------------------------------------------------------
   Custom maintenance quotes
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceQuotes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceQuotes (
        QuoteId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceQuotes PRIMARY KEY,
        QuoteNumber NVARCHAR(50) NOT NULL,
        HouseholdId INT NULL,
        PlanId INT NOT NULL,
        QuoteStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_Status DEFAULT ('Draft'),
        PropertyName NVARCHAR(255) NOT NULL,
        ContactName NVARCHAR(200) NULL,
        ContactEmail NVARCHAR(255) NULL,
        ContactPhone NVARCHAR(50) NULL,
        ServiceAddress NVARCHAR(500) NOT NULL,
        PreparedByUserId NVARCHAR(100) NULL,
        PreparedByDisplayName NVARCHAR(150) NULL,
        ValidUntil DATE NULL,
        PricingVersion NVARCHAR(50) NULL,
        TermsVersion NVARCHAR(50) NULL,
        AssetCount INT NOT NULL,
        IncludedAssetCount INT NOT NULL,
        AdditionalAssetCount INT NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_AdditionalCount DEFAULT (0),
        AdditionalAssetRate DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_AdditionalRate DEFAULT (0),
        BaseAmount DECIMAL(12,2) NOT NULL,
        AdditionalAssetAmount DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_AdditionalAmount DEFAULT (0),
        ImucAddOnCount INT NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_ImucCount DEFAULT (0),
        ImucAddOnRate DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_ImucRate DEFAULT (0),
        ImucAddOnAmount DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_ImucAmount DEFAULT (0),
        AdjustmentLabel NVARCHAR(255) NULL,
        ManualAdjustmentAmount DECIMAL(12,2) NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_Adjustment DEFAULT (0),
        AnnualTotalAmount DECIMAL(12,2) NOT NULL,
        CustomReviewRequired BIT NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_CustomReview DEFAULT (0),
        ManagementApprovedAt DATETIME2 NULL,
        ManagementApprovedByUserId NVARCHAR(100) NULL,
        CustomerNotes NVARCHAR(MAX) NULL,
        InternalNotes NVARCHAR(MAX) NULL,
        PdfStorageKey NVARCHAR(500) NULL,
        PublicShareTokenHash NVARCHAR(200) NULL,
        AcceptedAt DATETIME2 NULL,
        ConvertedSubscriptionId INT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceQuotes_UpdatedAt DEFAULT SYSUTCDATETIME(),
        VersionStamp ROWVERSION,
        CONSTRAINT UQ_MaintenanceQuotes_Number UNIQUE (QuoteNumber),
        CONSTRAINT FK_MaintenanceQuotes_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId),
        CONSTRAINT FK_MaintenanceQuotes_Plans
            FOREIGN KEY (PlanId) REFERENCES dbo.MaintenancePlans(PlanId),
        CONSTRAINT FK_MaintenanceQuotes_Subscriptions
            FOREIGN KEY (ConvertedSubscriptionId) REFERENCES dbo.MaintenanceSubscriptions(SubscriptionId)
    );

    CREATE INDEX IX_MaintenanceQuotes_Status
        ON dbo.MaintenanceQuotes(QuoteStatus, ValidUntil, CreatedAt DESC);
END;
GO

IF OBJECT_ID('dbo.MaintenanceQuoteItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceQuoteItems (
        QuoteItemId INT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceQuoteItems PRIMARY KEY,
        QuoteId INT NOT NULL,
        AssetTypeCode NVARCHAR(50) NOT NULL,
        AssetTypeName NVARCHAR(100) NOT NULL,
        Brand NVARCHAR(100) NULL,
        Model NVARCHAR(100) NULL,
        LocationName NVARCHAR(150) NULL,
        Quantity INT NOT NULL
            CONSTRAINT DF_MaintenanceQuoteItems_Quantity DEFAULT (1),
        SelectedVisitsPerYear DECIMAL(6,2) NULL,
        UnitAmount DECIMAL(12,2) NULL,
        LineAmount DECIMAL(12,2) NULL,
        SortOrder INT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceQuoteItems_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenanceQuoteItems_Quotes
            FOREIGN KEY (QuoteId) REFERENCES dbo.MaintenanceQuotes(QuoteId) ON DELETE CASCADE
    );
END;
GO

/* -------------------------------------------------------------------------
   Activity and audit log
   ------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.MaintenanceActivityLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaintenanceActivityLog (
        ActivityLogId BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_MaintenanceActivityLog PRIMARY KEY,
        HouseholdId INT NULL,
        SubscriptionId INT NULL,
        VisitId INT NULL,
        HealthReportId INT NULL,
        QuoteId INT NULL,
        ActionType NVARCHAR(100) NOT NULL,
        ActionSummary NVARCHAR(1000) NOT NULL,
        ActorUserId NVARCHAR(100) NULL,
        ActorDisplayName NVARCHAR(150) NULL,
        CorrelationId NVARCHAR(100) NULL,
        BeforeJson NVARCHAR(MAX) NULL,
        AfterJson NVARCHAR(MAX) NULL,
        MetadataJson NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_MaintenanceActivityLog_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_MaintenanceActivityLog_Households
            FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId),
        CONSTRAINT FK_MaintenanceActivityLog_Subscriptions
            FOREIGN KEY (SubscriptionId) REFERENCES dbo.MaintenanceSubscriptions(SubscriptionId),
        CONSTRAINT FK_MaintenanceActivityLog_Visits
            FOREIGN KEY (VisitId) REFERENCES dbo.MaintenanceVisits(VisitId),
        CONSTRAINT FK_MaintenanceActivityLog_Reports
            FOREIGN KEY (HealthReportId) REFERENCES dbo.MaintenanceHealthReports(HealthReportId),
        CONSTRAINT FK_MaintenanceActivityLog_Quotes
            FOREIGN KEY (QuoteId) REFERENCES dbo.MaintenanceQuotes(QuoteId)
    );

    CREATE INDEX IX_MaintenanceActivityLog_Household
        ON dbo.MaintenanceActivityLog(HouseholdId, CreatedAt DESC);

    CREATE INDEX IX_MaintenanceActivityLog_Visit
        ON dbo.MaintenanceActivityLog(VisitId, CreatedAt DESC);
END;
GO

/* -------------------------------------------------------------------------
   Operational views
   ------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.vw_MaintenanceDueQueue
AS
SELECT
    v.VisitId,
    v.DueDate,
    v.DueLabel,
    v.AssetScope,
    v.VisitStatus,
    v.ChargeType,
    v.ChargeEligibilityStatus,
    v.PaymentStatus,
    v.AmountToCharge,
    v.ServiceOrderSystem,
    v.ServiceOrderId,
    v.ServiceOrderNumber,
    v.ServiceOrderStatus,
    v.ReportRequired,
    v.ReportStatus,
    v.FilterReviewRequired,
    h.HouseholdId,
    h.HouseholdReference,
    h.DisplayName AS HouseholdName,
    h.Address1,
    h.City,
    h.StateCode,
    h.PostalCode,
    p.PlanCode,
    p.PlanCategory,
    p.PlanName,
    s.SubscriptionId,
    s.AnnualAmount,
    s.AutoRenew,
    s.RenewalDate,
    pp.PaymentProfileStatus,
    pp.CardBrand,
    pp.CardLast4,
    (
        SELECT COUNT(*)
        FROM dbo.MaintenanceSubscriptionAssets sa
        WHERE sa.SubscriptionId = s.SubscriptionId
          AND sa.CoverageStatus = 'Covered'
    ) AS CoveredAssetCount,
    (
        SELECT COUNT(*)
        FROM dbo.MaintenanceFilters f
        WHERE f.HouseholdId = h.HouseholdId
          AND f.NextDueOn <= DATEADD(day, 30, CAST(GETDATE() AS date))
          AND f.FilterStatus NOT IN ('Replaced', 'Inactive')
    ) AS FiltersDueWithin30Days
FROM dbo.MaintenanceVisits v
INNER JOIN dbo.MaintenanceHouseholds h
    ON h.HouseholdId = v.HouseholdId
INNER JOIN dbo.MaintenanceSubscriptions s
    ON s.SubscriptionId = v.SubscriptionId
INNER JOIN dbo.MaintenancePlans p
    ON p.PlanId = s.PlanId
LEFT JOIN dbo.MaintenancePaymentProfiles pp
    ON pp.PaymentProfileId = s.PaymentProfileId;
GO

CREATE OR ALTER VIEW dbo.vw_MaintenanceFilterQueue
AS
SELECT
    f.FilterId,
    f.NextDueOn,
    f.FilterStatus,
    f.CoverageCode,
    f.FilterType,
    f.PartNumber,
    f.Quantity,
    f.FilterLocation,
    f.SupplySource,
    f.UnitCost,
    f.CustomerCharge,
    h.HouseholdId,
    h.DisplayName AS HouseholdName,
    a.AssetId,
    a.AssetTypeName,
    a.Brand,
    a.Model,
    a.LocationName AS AssetLocation,
    s.SubscriptionId,
    p.PlanCode,
    p.PlanName
FROM dbo.MaintenanceFilters f
INNER JOIN dbo.MaintenanceHouseholds h
    ON h.HouseholdId = f.HouseholdId
LEFT JOIN dbo.MaintenanceAssets a
    ON a.AssetId = f.AssetId
LEFT JOIN dbo.MaintenanceSubscriptions s
    ON s.SubscriptionId = f.SubscriptionId
LEFT JOIN dbo.MaintenancePlans p
    ON p.PlanId = s.PlanId;
GO

CREATE OR ALTER VIEW dbo.vw_MaintenanceQuoteSummary
AS
SELECT
    q.QuoteId,
    q.QuoteNumber,
    q.QuoteStatus,
    q.PropertyName,
    q.ContactName,
    q.ValidUntil,
    q.AssetCount,
    q.CustomReviewRequired,
    q.AnnualTotalAmount,
    q.CreatedAt,
    q.UpdatedAt,
    p.PlanCode,
    p.PlanName
FROM dbo.MaintenanceQuotes q
INNER JOIN dbo.MaintenancePlans p
    ON p.PlanId = q.PlanId;
GO

/* -------------------------------------------------------------------------
   Example dispatcher queries
   ------------------------------------------------------------------------- */
SELECT *
FROM dbo.vw_MaintenanceDueQueue
WHERE DueDate <= DATEADD(day, 30, CAST(GETDATE() AS date))
  AND VisitStatus NOT IN ('Completed', 'Cancelled')
ORDER BY DueDate, HouseholdName;
GO

SELECT *
FROM dbo.vw_MaintenanceFilterQueue
WHERE NextDueOn <= DATEADD(day, 30, CAST(GETDATE() AS date))
ORDER BY NextDueOn, HouseholdName;
GO

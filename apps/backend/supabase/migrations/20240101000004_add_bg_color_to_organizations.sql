-- Add background color field to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS bg_color TEXT;

-- Add comment for documentation
COMMENT ON COLUMN organizations.bg_color IS 'Background color for checkout page (hex color code, e.g., #FFFFFF)';

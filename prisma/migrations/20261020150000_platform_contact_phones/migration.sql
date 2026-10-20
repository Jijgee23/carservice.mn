-- Super admin тохируулах холбоо барих утаснууд (хоосон бол кодын CONTACT.phones).
ALTER TABLE "PlatformSetting" ADD COLUMN "contactPhones" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- FK lookups used by terminal account archive/cascade and lifecycle retention.
CREATE INDEX "FreeEmailEnrollment_userId_idx" ON "FreeEmailEnrollment"("userId");
CREATE INDEX "EmailDeliveryEvent_messageId_idx" ON "EmailDeliveryEvent"("messageId");
CREATE INDEX "EmailLifecycleEntry_messageId_idx" ON "EmailLifecycleEntry"("messageId");
CREATE INDEX "EmailLifecycleOperationalEvent_messageId_idx" ON "EmailLifecycleOperationalEvent"("messageId");

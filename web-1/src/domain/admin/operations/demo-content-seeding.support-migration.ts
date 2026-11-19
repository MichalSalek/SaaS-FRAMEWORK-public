import { DB_CLIENT } from '@app/db/db.client';
import {
  SupportSenderTypeValue,
  SupportThreadStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { TIME } from '@kernel/application/constants.config';
import { DEMO_SUPPORT_THREAD } from './demo-content-seeding.config';

/**
 * Replaces one exact, retired seed reply inside its stable demo support thread.
 * User-authored messages and other replies are left untouched.
 */
export const refreshRetiredDemoSupportReply_IO = async ({
  threadId,
  retiredContent,
  content,
}: {
  threadId: string;
  retiredContent: string;
  content: string;
}): Promise<void> => {
  if (retiredContent === content) {
    return;
  }
  await DB_CLIENT.use.supportMessage.updateMany({
    where: {
      thread_id: threadId,
      sender_type: SupportSenderTypeValue.SUPPORT,
      content: retiredContent,
    },
    data: { content },
  });
};

export const ensureDemoSupportThread_IO = async ({
  userId,
  now,
  results,
}: {
  userId: string;
  now: Date;
  results: string[];
}): Promise<void> => {
  const supportThread = await DB_CLIENT.use.supportThread.findFirst({
    where: { user_id: userId, subject: DEMO_SUPPORT_THREAD.subject },
  });
  if (!supportThread) {
    await DB_CLIENT.use.supportThread.create({
      data: {
        user_id: userId,
        subject: DEMO_SUPPORT_THREAD.subject,
        status: SupportThreadStatusValue.OPEN,
        messages: {
          // Different timestamps keep the support reply below the client's question.
          create: [
            {
              sender_type: SupportSenderTypeValue.USER,
              content: DEMO_SUPPORT_THREAD.user_message,
              created_at: new Date(now.getTime() - 2 * TIME.MS_PER_HOUR),
            },
            {
              sender_type: SupportSenderTypeValue.SUPPORT,
              content: DEMO_SUPPORT_THREAD.support_reply,
              created_at: new Date(now.getTime() - TIME.MS_PER_HOUR),
            },
          ],
        },
      },
    });
    results.push('Demo support thread created');
    return;
  }

  await refreshRetiredDemoSupportReply_IO({
    threadId: supportThread.id,
    retiredContent: DEMO_SUPPORT_THREAD.retired_support_reply,
    content: DEMO_SUPPORT_THREAD.support_reply,
  });
};

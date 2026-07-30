export interface NotificationTransport {
  deliver(to: string, body: string): Promise<void>;
}

export interface Operator {
  handleWebSocketOpen(): void;
  handleWebSocketClosed(): void;
  handleWebSocketError(): void;
}

function unavailable(): never {
  throw new Error("Windows 必须使用 DPAPI，禁止调用 keytar");
}

export async function getPassword(
  _service: string,
  _account: string,
): Promise<string | null> {
  return unavailable();
}

export async function setPassword(
  _service: string,
  _account: string,
  _password: string,
): Promise<void> {
  unavailable();
}

export async function deletePassword(
  _service: string,
  _account: string,
): Promise<boolean> {
  return unavailable();
}

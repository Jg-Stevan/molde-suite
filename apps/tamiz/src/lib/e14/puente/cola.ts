// Cola de envíos pendientes del puente (cuenta desde el store local).

export async function contarPendientes(): Promise<number> {
  const { useE14Store } = await import('../store');
  return useE14Store.getState().colaOffline;
}

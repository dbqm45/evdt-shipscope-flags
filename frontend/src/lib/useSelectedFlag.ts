import { useSearchParams } from "react-router-dom";
import { useStore } from "../state/useStore";

export function useSelectedFlag() {
  const [params, setParams] = useSearchParams();
  const { flags } = useStore();
  const flagKey = params.get("flag");
  const selectedFlag = flagKey ? (flags.find((f) => f.key === flagKey) ?? null) : null;

  function select(key: string | null) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key) next.set("flag", key);
      else next.delete("flag");
      return next;
    });
  }

  return { selectedFlag, select };
}

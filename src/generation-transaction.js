export async function runGenerationTransaction({ eventSource, stoppedEvent, generate }) {
    let stopped = false;
    const onStopped = () => { stopped = true; };
    eventSource.on(stoppedEvent, onStopped);
    try {
        const result = await generate();
        if (stopped) throw new Error('本次主持生成已停止。');
        if (result === undefined || result === null || String(result).trim() === '') throw new Error('主持人没有生成正式回复。');
        return result;
    } finally {
        eventSource.removeListener(stoppedEvent, onStopped);
    }
}

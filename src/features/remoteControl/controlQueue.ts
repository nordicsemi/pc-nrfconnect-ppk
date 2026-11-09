/*
 * Copyright (c) 2026 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import { type RootState } from '../../slices';
import { appState } from '../../slices/appSlice';

export interface RunningCall {
    name: string;
    origin: string;
    sinceMs: number;
}

export type Grant = Slot | 'busy' | 'cancelled' | 'stopped';

type Call = Omit<RunningCall, 'sinceMs'>;

// How a call is queued, kept until it runs.
interface Ticket {
    call: Call;
    powersOn: boolean;
    // The power-off generation when the call was queued.
    since: number;
}

interface Waiter extends Ticket {
    grant: (grant: Grant) => void;
    // Clears the busy timer and the stop listener.
    dispose: () => void;
}

export interface Slot {
    release: () => void;
    // True when the call may switch the DUT power on and the power was
    // switched off since it was queued: the power off wins, also when it
    // came after the call left the queue or while it runs.
    poweredOff: () => boolean;
}

// Runs remote control calls one at a time, first come first served, for
// every server (MCP and REST) of the app.
//
// - A call waiting longer than `waitMs` leaves the queue and gets `busy`;
//   it never runs.
// - `powerOff()` (called whenever the DUT power goes off, see
//   cancelPowerOnsOnPowerOff) cancels every waiting call that may switch
//   the DUT power on again.
// - A call whose `signal` aborts (its server stopped) leaves the queue and
//   gets `stopped`; it never runs.
// - The slot is held until `release()`, which the caller invokes once,
//   when its handler is really done, also after answering `timeout`.
export class ControlQueue {
    #running?: RunningCall;
    #waiting: Waiter[] = [];
    #powerOffGeneration = 0;

    // The call holding the queue, also one that already timed out.
    get busyOp(): RunningCall | undefined {
        return this.#running;
    }

    // Number of calls waiting in the queue.
    get waitingCount() {
        return this.#waiting.length;
    }

    acquire(
        call: Call,
        {
            waitMs,
            powersOn,
            signal,
        }: { waitMs: number; powersOn: boolean; signal?: AbortSignal },
    ): Promise<Grant> {
        const ticket = { call, powersOn, since: this.#powerOffGeneration };
        // Nothing waits while nothing runs: release() starts the next one.
        if (!this.#running) {
            return Promise.resolve(this.#start(ticket));
        }
        return new Promise(grant => {
            const waiter: Waiter = { ...ticket, grant, dispose: () => {} };
            const leave = (reason: 'busy' | 'stopped') => () => {
                this.#remove(waiter);
                grant(reason);
            };
            const timer = setTimeout(leave('busy'), waitMs);
            const onStop = leave('stopped');
            signal?.addEventListener('abort', onStop, { once: true });
            waiter.dispose = () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onStop);
            };
            this.#waiting.push(waiter);
        });
    }

    powerOff() {
        this.#powerOffGeneration += 1;
        this.#waiting
            .filter(waiter => waiter.powersOn)
            .forEach(waiter => {
                this.#remove(waiter);
                waiter.grant('cancelled');
            });
    }

    #remove(waiter: Waiter) {
        waiter.dispose();
        this.#waiting = this.#waiting.filter(w => w !== waiter);
    }

    #start({ call, powersOn, since }: Ticket): Slot {
        this.#running = { ...call, sinceMs: Date.now() };
        return {
            release: () => {
                this.#running = undefined;
                const next = this.#waiting[0];
                if (next) {
                    this.#remove(next);
                    next.grant(this.#start(next));
                }
            },
            poweredOff: () => powersOn && this.#powerOffGeneration !== since,
        };
    }
}

export const controlQueue = new ControlQueue();

// Calls queue.powerOff() whenever the DUT power goes off, whatever switched
// it off: an API call, the human in the UI, a switch to source mode. Returns
// the unsubscribe function.
export const cancelPowerOnsOnPowerOff = (
    store: {
        getState: () => RootState;
        subscribe: (listener: () => void) => () => void;
    },
    queue: ControlQueue = controlQueue,
) => {
    let wasOn = appState(store.getState()).deviceRunning;
    return store.subscribe(() => {
        const isOn = appState(store.getState()).deviceRunning;
        if (wasOn && !isOn) queue.powerOff();
        wasOn = isOn;
    });
};

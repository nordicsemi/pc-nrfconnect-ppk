/*
 * Copyright (c) 2015 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

// macOS-specific serial worker.
//
// Identical to serialDevice.js except that after port.open() the native
// binding's read() is replaced with a polling loop.  This works around a
// known macOS kqueue bug where uv_poll_start(UV_READABLE) silently stops
// delivering notifications for USB CDC tty file descriptors after
// approximately 60-90 minutes of continuous data.
//
// The polling approach mirrors what pyserial does (ioctl(TIOCINQ) +
// synchronous read) and has been verified over 5+ hour sessions.
//
// See: https://github.com/serialport/node-serialport/issues/2787
//      https://github.com/libuv/libuv/issues/2428

const { resolve } = require('path');
const fs = require('fs');

const { execPath } = process;

const asarPath = (() => {
    if (/node_modules/.test(execPath)) {
        return resolve(execPath.split('node_modules')[0]);
    }
    return resolve(execPath.split('/Frameworks/')[0], 'Resources', 'app.asar');
})();

// eslint-disable-next-line import/no-dynamic-require
const { SerialPort } = require(resolve(asarPath, 'node_modules', 'serialport'));

let port = null;
process.on('message', msg => {
    if (msg.open) {
        console.log('\x1b[2J'); // ansi clear screen
        process.send({ opening: msg.open });
        port = new SerialPort({
            path: msg.open,
            autoOpen: false,
            baudRate: 115200,
        });

        let data = Buffer.alloc(0);
        port.on('data', buf => {
            data = Buffer.concat([data, buf]);
        });
        setInterval(() => {
            if (data.length === 0) return;
            process.send(data.slice(), err => {
                if (err) console.log(err);
            });
            data = Buffer.alloc(0);
        }, 30);
        port.open(err => {
            if (err) {
                process.send({ error: err.toString() });
                return;
            }

            // Replace the native binding's kqueue-based read with a polling
            // loop so that data delivery does not depend on uv_poll.
            const binding = port.port;
            if (binding) {
                const fd = binding.fd;
                const readBuf = Buffer.allocUnsafe(65536);

                binding.read = function pollingRead(buffer, offset, length) {
                    return new Promise((res, reject) => {
                        const poll = () => {
                            fs.read(
                                fd,
                                readBuf,
                                0,
                                Math.min(length, readBuf.length),
                                null,
                                (fsErr, bytesRead) => {
                                    if (fsErr) {
                                        if (
                                            fsErr.code === 'EAGAIN' ||
                                            fsErr.code === 'EWOULDBLOCK'
                                        ) {
                                            setTimeout(poll, 1);
                                            return;
                                        }
                                        reject(fsErr);
                                        return;
                                    }
                                    if (bytesRead > 0) {
                                        readBuf.copy(
                                            buffer,
                                            offset,
                                            0,
                                            bytesRead,
                                        );
                                        res({ bytesRead, buffer });
                                        return;
                                    }
                                    setTimeout(poll, 1);
                                },
                            );
                        };
                        poll();
                    });
                };
                console.log(`Polling read active (kqueue bypass, fd=${fd})`);
            }

            process.send({ started: msg.open });
        });
    }
    if (msg.write) {
        port.write(msg.write, err => {
            if (err) {
                process.send({ error: 'PPK command failed' });
            }
        });
    }
});

process.on('disconnect', () => {
    console.log('parent process disconnected, cleaning up');
    if (port) {
        port.close(process.exit);
    } else {
        process.exit();
    }
});

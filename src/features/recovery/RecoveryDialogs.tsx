/*
 * Copyright (c) 2025 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: LicenseRef-Nordic-4-Clause
 */

import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    addConfirmBeforeClose,
    Alert,
    Button,
    clearConfirmBeforeClose,
    DialogButton,
    GenericDialog,
    logger,
    useStopwatch,
} from '@nordicsemiconductor/pc-nrfconnect-shared';

import {
    isSessionRecoveryPending,
    setSavePending,
} from '../../slices/appSlice';
import { formatDuration, formatTimestamp } from '../../utils/formatters';
import TimeComponent from '../ProgressDialog/TimeComponent';
import { RecoveryManager } from './RecoveryManager';
import {
    DeleteAllSessions,
    RemoveSessionByFilePath,
    type Session,
    SessionFlag,
} from './SessionsListFileHandler';

const SessionItem = ({
    session,
    onRecoverClick,
    onRemoveClick,
}: {
    session: Session;
    onRecoverClick: (session: Session) => void;
    onRemoveClick: (session: Session) => void;
}) => {
    const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
    return (
        <div className="tw-relative">
            <div className="tw-flex tw-flex-row tw-justify-between tw-bg-gray-800 tw-p-3 tw-text-white">
                <div>
                    <div className="tw-text-xs">Start time</div>
                    <div>{formatTimestamp(session.startTime)}</div>
                </div>
                <div>
                    <div className="tw-text-xs">Duration</div>
                    <div>{formatDuration(session.samplingDuration || 0)}</div>
                </div>
                <div>
                    <div className="tw-text-xs">Sampling rate</div>
                    <div>{session.samplingRate}</div>
                </div>
                <div className="tw-content-center tw-align-middle">
                    <div className="tw-flex tw-flex-row tw-gap-2">
                        <Button
                            variant="secondary"
                            className="tw-w-[62px] tw-border-white"
                            onClick={() => setShowDeleteConfirmation(true)}
                        >
                            Delete
                        </Button>
                        <Button
                            variant="primary"
                            className="tw-w-[62px]"
                            onClick={() => onRecoverClick(session)}
                        >
                            Recover
                        </Button>
                    </div>
                </div>
            </div>
            {showDeleteConfirmation && (
                <div className="tw-absolute tw-inset-0 tw-z-10 tw-flex tw-min-h-full tw-flex-row tw-items-center tw-justify-center tw-gap-3 tw-bg-gray-900 tw-p-3 tw-text-white">
                    <div className="tw-flex-1">
                        Are you sure? This action cannot be undone.
                    </div>
                    <div className="tw-content-center tw-align-middle">
                        <div className="tw-flex tw-flex-row tw-gap-2">
                            <Button
                                variant="secondary"
                                className="tw-w-[60px] tw-border-white"
                                onClick={() => setShowDeleteConfirmation(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                className="tw-w-[60px]"
                                onClick={() => onRemoveClick(session)}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const ItemizedSessions = ({
    orphanedSessions,
    onRecoverClick,
    onRemoveClick,
}: {
    orphanedSessions: Session[];
    onRecoverClick: (session: Session) => void;
    onRemoveClick: (session: Session) => void;
}) => (
    <div className="tw-flex tw-flex-col tw-gap-2">
        {orphanedSessions.map(session => (
            <SessionItem
                key={session.filePath}
                session={session}
                onRecoverClick={onRecoverClick}
                onRemoveClick={onRemoveClick}
            />
        ))}
    </div>
);

export default () => {
    const dispatch = useDispatch();
    const recoveryManager = RecoveryManager.getInstance();

    const pendingRecovery = useSelector(isSessionRecoveryPending);
    const [isSessionsListDialogVisible, setIsSessionsListDialogVisible] =
        useState(false);
    const [orphanedSessions, setOrphanedSessions] = useState<Session[]>([]);
    const [isRecovering, setIsRecovering] = useState(false);
    const [recoveryProgress, setRecoveryProgress] = useState(0);
    const [recoveryError, setRecoveryError] = useState<string | null>(null);

    const lastProgress = useRef(-1);
    const { time, reset, pause, start } = useStopwatch({
        autoStart: true,
        resolution: 1000,
    });

    useEffect(() => {
        if (!isRecovering) {
            lastProgress.current = -1;
            pause();
        } else {
            start(0);
        }
    }, [isRecovering, pause, start]);

    useEffect(() => {
        if (recoveryProgress < lastProgress.current) {
            lastProgress.current = recoveryProgress;
            reset();
        }
    }, [recoveryProgress, reset]);

    useEffect(() => {
        if (pendingRecovery) {
            dispatch(
                addConfirmBeforeClose({
                    id: 'sessionRecoveryInProgress',
                    message:
                        'There is a session recovery in progress. If you close the application, the progress will be lost and the session will remain in the recovery list. Are you sure you want to close?',
                }),
            );
        } else {
            dispatch(clearConfirmBeforeClose('sessionRecoveryInProgress'));
        }
    }, [dispatch, pendingRecovery]);

    useEffect(() => {
        recoveryManager.searchOrphanedSessions(
            () => {},
            (orphanSessions: Session[]) => {
                if (orphanSessions.length > 0) {
                    setOrphanedSessions(orphanSessions);
                    setIsSessionsListDialogVisible(true);
                }
            },
        );
    }, [recoveryManager]);

    const [showDeleteAllConfirmation, setShowDeleteAllConfirmation] =
        useState(false);

    return (
        <>
            <GenericDialog
                className="tw-preflight tw-max-h-screen"
                title={
                    showDeleteAllConfirmation
                        ? 'Delete all sessions'
                        : 'Session recovery'
                }
                footer={
                    <>
                        {!showDeleteAllConfirmation && (
                            <>
                                <DialogButton
                                    variant="secondary"
                                    onClick={() =>
                                        setIsSessionsListDialogVisible(false)
                                    }
                                >
                                    Close
                                </DialogButton>
                                <DialogButton
                                    variant="secondary"
                                    onClick={() => {
                                        setShowDeleteAllConfirmation(true);
                                    }}
                                    disabled={orphanedSessions.length === 0}
                                >
                                    Delete all
                                </DialogButton>
                            </>
                        )}
                        {showDeleteAllConfirmation && (
                            <>
                                <DialogButton
                                    variant="secondary"
                                    onClick={() => {
                                        setShowDeleteAllConfirmation(false);
                                    }}
                                >
                                    Cancel
                                </DialogButton>
                                <DialogButton
                                    variant="danger"
                                    onClick={() =>
                                        DeleteAllSessions(
                                            () => {},
                                            () => {
                                                setIsSessionsListDialogVisible(
                                                    false,
                                                );
                                                setOrphanedSessions([]);
                                            },
                                        )
                                    }
                                >
                                    Delete all
                                </DialogButton>
                            </>
                        )}
                    </>
                }
                isVisible={
                    isSessionsListDialogVisible && orphanedSessions.length > 0
                }
                closeOnEsc
                closeOnUnfocus
            >
                <>
                    {!showDeleteAllConfirmation && (
                        <>
                            <div className="tw-mb-4">
                                The following sampling sessions did not close
                                properly and can be recovered:
                            </div>

                            <div className="core19-app tw-max-h-96 tw-overflow-y-auto tw-bg-white">
                                <ItemizedSessions
                                    orphanedSessions={orphanedSessions}
                                    onRecoverClick={session => {
                                        setIsSessionsListDialogVisible(false);
                                        if (
                                            session.flag ===
                                            SessionFlag.Recovered
                                        ) {
                                            dispatch(
                                                RecoveryManager.renderSessionData(
                                                    session,
                                                    () => {
                                                        dispatch(
                                                            setSavePending(
                                                                true,
                                                            ),
                                                        );
                                                    },
                                                    error => {
                                                        logger.error(
                                                            error.message,
                                                        );
                                                    },
                                                ),
                                            );
                                            return;
                                        }
                                        setIsRecovering(true);
                                        setRecoveryProgress(0);
                                        setRecoveryError(null);
                                        reset();

                                        dispatch(
                                            recoveryManager.recoverSession(
                                                session,
                                                (progress: number) =>
                                                    setRecoveryProgress(
                                                        progress,
                                                    ),
                                                () => {
                                                    pause();
                                                    setIsRecovering(false);
                                                    dispatch(
                                                        setSavePending(true),
                                                    );
                                                },
                                                (error: Error) => {
                                                    logger.error(error.message);
                                                    pause();
                                                    setIsRecovering(false);
                                                    dispatch(
                                                        setSavePending(false),
                                                    );
                                                },
                                                pause,
                                            ),
                                        );
                                    }}
                                    onRemoveClick={session => {
                                        RemoveSessionByFilePath(
                                            session.filePath,
                                            () => {
                                                setOrphanedSessions(
                                                    orphanedSessions.filter(
                                                        s =>
                                                            s.filePath !==
                                                            session.filePath,
                                                    ),
                                                );
                                            },
                                        );
                                    }}
                                />
                                {orphanedSessions.length === 0 && (
                                    <div>No sessions found</div>
                                )}
                            </div>
                        </>
                    )}

                    {showDeleteAllConfirmation && (
                        <div>
                            Are you sure you want to delete all sessions? This
                            action cannot be undone.
                        </div>
                    )}
                </>
            </GenericDialog>
            <GenericDialog
                className="tw-preflight tw-max-h-screen"
                title="Session recovery"
                footer={
                    <DialogButton
                        variant="secondary"
                        onClick={() => {
                            if (!recoveryError)
                                recoveryManager.cancelRecoveryProcess();
                            setIsRecovering(false);
                            setIsSessionsListDialogVisible(true);
                        }}
                    >
                        Cancel
                    </DialogButton>
                }
                isVisible={isRecovering}
            >
                <div className="tw-flex tw-w-full tw-flex-col tw-gap-2">
                    <div>
                        <span>
                            The session is being recovered. Please wait.
                        </span>
                        <br />
                    </div>
                    <TimeComponent
                        time={time}
                        progress={recoveryProgress}
                        indeterminate={false}
                    />
                    {recoveryError && (
                        <Alert variant="danger">{recoveryError}</Alert>
                    )}
                </div>
            </GenericDialog>
        </>
    );
};

use codex_extension_items::ExtensionItem;
use codex_extension_items::image_generation::GeneratedImageRef;
use codex_extension_items::image_generation::ImageGenerationItem;
use codex_protocol::ThreadId;
use codex_protocol::items::CommandExecutionItem;
use codex_protocol::items::CommandExecutionStatus;
use codex_protocol::items::TurnItem;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::ExecCommandSource;
use codex_protocol::protocol::ImageGenerationEndEvent;
use codex_protocol::protocol::ItemCompletedEvent;
use codex_protocol::protocol::ItemStartedEvent;
use codex_protocol::protocol::ThreadHistoryMode;

use super::persisted_event_msg;

#[test]
fn background_confirmation_is_durable_without_changing_native_persistence() {
    for history_mode in [ThreadHistoryMode::Legacy, ThreadHistoryMode::Paginated] {
        for backgrounded in [None, Some(false), Some(true)] {
            let command = CommandExecutionItem {
                id: "command".to_string(),
                model_context: None,
                sandbox_type: None,
                plugin_id: None,
                script_path: None,
                process_id: Some("123".to_string()),
                backgrounded,
                command: vec!["proof".to_string()],
                description: None,
                cwd: "file:///tmp".parse().expect("cwd"),
                parsed_cmd: Vec::new(),
                source: ExecCommandSource::UnifiedExecStartup,
                interaction_input: None,
                status: CommandExecutionStatus::InProgress,
                aggregated_output: None,
                exit_code: None,
                duration: None,
            };
            let started = EventMsg::ItemStarted(ItemStartedEvent {
                thread_id: ThreadId::new(),
                turn_id: "turn".to_string(),
                item: TurnItem::CommandExecution(command.clone()),
                started_at_ms: 10,
            });
            assert_eq!(
                persisted_event_msg(&started, history_mode).is_some(),
                backgrounded == Some(true)
            );
            let completed = EventMsg::ItemCompleted(ItemCompletedEvent {
                thread_id: ThreadId::new(),
                turn_id: "turn".to_string(),
                item: TurnItem::CommandExecution(CommandExecutionItem {
                    status: CommandExecutionStatus::Completed,
                    aggregated_output: Some("x".repeat(128 * 1024)),
                    exit_code: Some(0),
                    ..command
                }),
                started_at_ms: Some(10),
                completed_at_ms: 20,
            });
            let persisted = persisted_event_msg(&completed, history_mode);
            assert_eq!(
                persisted.is_some(),
                backgrounded.is_some() || history_mode == ThreadHistoryMode::Paginated
            );
            if let Some(persisted) = persisted {
                let EventMsg::ItemCompleted(completed) = persisted.as_ref() else {
                    panic!("completed event")
                };
                let TurnItem::CommandExecution(command) = &completed.item else {
                    panic!("command")
                };
                assert_eq!(command.backgrounded, backgrounded);
                assert_eq!(
                    command.aggregated_output.as_ref().expect("output").len(),
                    64 * 1024
                );
            }
        }
    }
}

fn image_item(image: GeneratedImageRef) -> ImageGenerationItem {
    ImageGenerationItem {
        id: "image-1".to_string(),
        status: "completed".to_string(),
        revised_prompt: Some("paint a blue whale".to_string()),
        image,
        transparent_background: Some(false),
        failure: None,
        saved_path: None,
        input_images: Vec::new(),
        imagegen_request_id: None,
        generation_id: None,
    }
}

#[test]
fn paginated_image_generation_preserves_file_reference() {
    let event = EventMsg::ItemCompleted(ItemCompletedEvent {
        thread_id: ThreadId::new(),
        turn_id: "turn-1".to_string(),
        item: TurnItem::Extension(ExtensionItem::ImageGeneration(image_item(
            GeneratedImageRef::File {
                file_id: "file-1".to_string(),
            },
        ))),
        started_at_ms: Some(1),
        completed_at_ms: 2,
    });

    let persisted = persisted_event_msg(&event, ThreadHistoryMode::Paginated)
        .expect("expected persisted image-generation item");
    let EventMsg::ItemCompleted(persisted) = persisted.as_ref() else {
        panic!("expected persisted image-generation item");
    };
    let TurnItem::Extension(ExtensionItem::ImageGeneration(image)) = &persisted.item else {
        panic!("expected image-generation extension item");
    };

    assert_eq!(
        image,
        &image_item(GeneratedImageRef::File {
            file_id: "file-1".to_string(),
        })
    );
}

#[test]
fn legacy_image_generation_preserves_file_reference() {
    let event = EventMsg::ImageGenerationEnd(ImageGenerationEndEvent {
        call_id: "image-1".to_string(),
        status: "completed".to_string(),
        revised_prompt: Some("paint a blue whale".to_string()),
        image: GeneratedImageRef::File {
            file_id: "file-1".to_string(),
        },
        transparent_background: Some(false),
        failure: None,
        saved_path: None,
        input_images: Vec::new(),
    });

    let persisted = persisted_event_msg(&event, ThreadHistoryMode::Legacy)
        .expect("expected persisted legacy image-generation event");
    let EventMsg::ImageGenerationEnd(persisted) = persisted.as_ref() else {
        panic!("expected persisted legacy image-generation event");
    };

    assert_eq!(
        persisted.image,
        GeneratedImageRef::File {
            file_id: "file-1".to_string(),
        }
    );
}

#[test]
fn inline_image_generation_result_is_preserved() {
    let event = EventMsg::ItemCompleted(ItemCompletedEvent {
        thread_id: ThreadId::new(),
        turn_id: "turn-1".to_string(),
        item: TurnItem::Extension(ExtensionItem::ImageGeneration(image_item(
            GeneratedImageRef::Inline {
                result: "base64-image".to_string(),
            },
        ))),
        started_at_ms: Some(1),
        completed_at_ms: 2,
    });

    let persisted = persisted_event_msg(&event, ThreadHistoryMode::Paginated)
        .expect("expected persisted inline image-generation item");
    let EventMsg::ItemCompleted(persisted) = persisted.as_ref() else {
        panic!("expected persisted inline image-generation item");
    };
    let TurnItem::Extension(ExtensionItem::ImageGeneration(image)) = &persisted.item else {
        panic!("expected inline image-generation extension item");
    };

    assert_eq!(
        image,
        &image_item(GeneratedImageRef::Inline {
            result: "base64-image".to_string(),
        })
    );
}

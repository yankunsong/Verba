"use client";

import React, { useState, useEffect, useRef } from "react";
import { MdCancel, MdOutlineRefresh } from "react-icons/md";
import { TbPlugConnected } from "react-icons/tb";
import { IoChatbubbleSharp } from "react-icons/io5";
import { FaHammer } from "react-icons/fa";
import { IoIosSend } from "react-icons/io";
import { BiError } from "react-icons/bi";
import { IoMdAddCircle } from "react-icons/io";

import {
  updateRAGConfig,
  sendUserQuery,
  fetchDatacount,
  fetchRAGConfig,
  fetchLabels,
} from "@/app/api";
import { getWebSocketApiHost } from "@/app/util";
import {
  Credentials,
  QueryPayload,
  DataCountPayload,
  ChunkScore,
  Message,
  LabelsResponse,
  RAGConfig,
  Theme,
  DocumentFilter,
} from "@/app/types";

import InfoComponent from "../Navigation/InfoComponent";
import ChatConfig from "./ChatConfig";
import ChatMessage from "./ChatMessage";

interface ChatInterfaceProps {
  credentials: Credentials;
  setSelectedDocument: (s: string | null) => void;
  setSelectedChunkScore: (c: ChunkScore[]) => void;
  currentPage: string;
  RAGConfig: RAGConfig | null;
  setRAGConfig: React.Dispatch<React.SetStateAction<RAGConfig | null>>;
  selectedTheme: Theme;
  production: "Local" | "Demo" | "Production";
  documentFilter: DocumentFilter[];
  setDocumentFilter: React.Dispatch<React.SetStateAction<DocumentFilter[]>>;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  production,
  credentials,
  setSelectedDocument,
  setSelectedChunkScore,
  currentPage,
  RAGConfig,
  selectedTheme,
  setRAGConfig,
  documentFilter,
  setDocumentFilter,
}) => {
  const [selectedSetting, setSelectedSetting] = useState("Chat");

  const isFetching = useRef<boolean>(false);
  const [fetchingStatus, setFetchingStatus] = useState<
    "DONE" | "CHUNKS" | "RESPONSE"
  >("DONE");

  const [previewText, setPreviewText] = useState("");
  const lastMessageRef = useRef<null | HTMLDivElement>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const [reconnect, setReconnect] = useState(false);

  const [labels, setLabels] = useState<string[]>([]);
  const [filterLabels, setFilterLabels] = useState<string[]>([]);

  const [selectedDocumentScore, setSelectedDocumentScore] = useState<
    string | null
  >(null);

  const [currentDatacount, setCurrentDatacount] = useState(0);

  const [userInput, setUserInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const currentEmbedding = RAGConfig
    ? (RAGConfig["Embedder"].components[RAGConfig["Embedder"].selected].config[
        "Model"
      ].value as string)
    : "No Config found";
  useState("No Embedding Model");

  useEffect(() => {
    setReconnect(true);
  }, []);

  useEffect(() => {
    if (RAGConfig) {
      retrieveDatacount();
    } else {
      setCurrentDatacount(0);
    }
  }, [currentEmbedding, currentPage]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 0) {
        return [
          {
            type: "system",
            content: selectedTheme.intro_message.text,
          },
        ];
      }
      return prev;
    });
  }, [selectedTheme.intro_message.text]);

  // Setup WebSocket and messages to /ws/generate_stream
  useEffect(() => {
    const socketHost = getWebSocketApiHost();
    const localSocket = new WebSocket(socketHost);

    localSocket.onopen = () => {
      console.log("WebSocket connection opened to " + socketHost);
      setSocketOnline(true);
    };

    localSocket.onmessage = (event) => {
      let data;

      if (!isFetching.current) {
        setPreviewText("");
        return;
      }

      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.error("Received data is not valid JSON:", event.data);
        return; // Exit early if data isn't valid JSON
      }

      const newMessageContent = data.message;
      setPreviewText((prev) => prev + newMessageContent);

      if (data.finish_reason === "stop") {
        isFetching.current = false;
        setFetchingStatus("DONE");
        const full_text = data.full_text;
        if (data.cached) {
          const distance = data.distance;
          setMessages((prev) => [
            ...prev,
            {
              type: "system",
              content: full_text,
              cached: true,
              distance: distance,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { type: "system", content: full_text },
          ]);
        }
        setPreviewText("");
      }
    };

    localSocket.onerror = (error) => {
      console.error("WebSocket Error:", error);
      setSocketOnline(false);
      isFetching.current = false;
      setFetchingStatus("DONE");
    };

    localSocket.onclose = (event) => {
      if (event.wasClean) {
        console.log(
          `WebSocket connection closed cleanly, code=${event.code}, reason=${event.reason}`
        );
      } else {
        console.error("WebSocket connection died");
      }
      setSocketOnline(false);
      isFetching.current = false;
      setFetchingStatus("DONE");
    };

    setSocket(localSocket);

    return () => {
      if (localSocket.readyState !== WebSocket.CLOSED) {
        localSocket.close();
      }
    };
  }, [reconnect]);

  useEffect(() => {
    if (RAGConfig) {
      retrieveDatacount();
    } else {
      setCurrentDatacount(0);
    }
  }, [RAGConfig]);

  const retrieveRAGConfig = async () => {
    const config = await fetchRAGConfig(credentials);
    if (config) {
      setRAGConfig(config.rag_config);
    }
  };

  const sendUserMessage = async () => {
    if (isFetching.current || !userInput.trim()) return;

    const sendInput = userInput;
    setUserInput("");
    isFetching.current = true;
    setFetchingStatus("CHUNKS");
    setMessages((prev) => [...prev, { type: "user", content: sendInput }]);

    try {
      const data = await sendUserQuery(
        sendInput,
        RAGConfig,
        filterLabels,
        documentFilter,
        credentials
      );

      if (!data || data.error) {
        handleErrorResponse(data ? data.error : "No data received");
      } else {
        handleSuccessResponse(data, sendInput);
      }
    } catch (error) {
      handleErrorResponse("Failed to fetch from API");
      console.error("Failed to fetch from API:", error);
    }
  };

  const handleErrorResponse = (errorMessage: string) => {
    setMessages((prev) => [...prev, { type: "error", content: errorMessage }]);
    isFetching.current = false;
    setFetchingStatus("DONE");
  };

  const handleSuccessResponse = (data: QueryPayload, sendInput: string) => {
    setMessages((prev) => [
      ...prev,
      { type: "retrieval", content: data.documents },
    ]);

    if (data.documents.length > 0) {
      const firstDoc = data.documents[0];
      setSelectedDocument(firstDoc.uuid);
      setSelectedDocumentScore(
        `${firstDoc.uuid}${firstDoc.score}${firstDoc.chunks.length}`
      );
      setSelectedChunkScore(firstDoc.chunks);

      if (data.context) {
        streamResponses(sendInput, data.context);
        setFetchingStatus("RESPONSE");
      }
    } else {
      handleErrorResponse("We couldn't find any chunks to your query");
    }
  };

  const streamResponses = (query?: string, context?: string) => {
    if (socket?.readyState === WebSocket.OPEN) {
      const filteredMessages = messages
        .slice(1) // Skip the first message
        .filter((msg) => msg.type === "user" || msg.type === "system")
        .map((msg) => ({
          type: msg.type,
          content: msg.content,
        }));

      const data = JSON.stringify({
        query: query,
        context: context,
        conversation: filteredMessages,
        rag_config: RAGConfig,
      });
      socket.send(data);
    } else {
      console.error("WebSocket is not open. ReadyState:", socket?.readyState);
    }
  };

  const handleKeyDown = (e: any) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault(); // Prevent new line
      sendUserMessage(); // Submit form
    }
  };

  const retrieveDatacount = async () => {
    try {
      const data: DataCountPayload | null = await fetchDatacount(
        currentEmbedding,
        credentials
      );
      const labels: LabelsResponse | null = await fetchLabels(credentials);
      if (data) {
        setCurrentDatacount(data.datacount);
      }
      if (labels) {
        setLabels(labels.labels);
      }
    } catch (error) {
      console.error("Failed to fetch from API:", error);
    }
  };

  const reconnectToVerba = () => {
    setReconnect((prevState) => !prevState);
  };

  const onSaveConfig = async () => {
    await updateRAGConfig(RAGConfig, credentials);
  };

  const onResetConfig = async () => {
    retrieveRAGConfig();
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Header */}
      <div className="bg-bg-alt-verba rounded-2xl flex gap-2 p-6 items-center justify-between h-min w-full">
        <div className="flex gap-2 justify-start items-center">
          <InfoComponent
            tooltip_text="Use the Chat interface to interact with your data and to perform Retrieval Augmented Generation (RAG)"
            display_text={"Chat"}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              setSelectedSetting("Chat");
            }}
            className={`flex ${selectedSetting === "Chat" ? "bg-primary-verba text-text-verba hover:bg-button-hover-verba" : "bg-button-verba hover:text-text-verba hover:bg-button-hover-verba"} border-none btn text-text-alt-verba gap-2`}
          >
            <IoChatbubbleSharp size={15} />
            <p>Chat</p>
          </button>

          <button
            onClick={() => {
              setSelectedSetting("Config");
            }}
            className={`flex ${selectedSetting === "Config" ? "bg-primary-verba text-text-verba hover:bg-button-hover-verba" : "bg-button-verba hover:text-text-verba hover:bg-button-hover-verba"} border-none btn text-text-alt-verba gap-2`}
          >
            <FaHammer size={15} />
            <p>Config</p>
          </button>
        </div>
      </div>

      <div className="bg-bg-alt-verba rounded-2xl flex flex-col h-full w-full overflow-y-auto overflow-x-hidden relative">
        {/* New fixed tab */}
        <div className="sticky flex flex-col gap-2 top-0 z-10 p-4 backdrop-blur-sm bg-opacity-70 bg-transparent rounded-lg">
          <div className="flex gap-2 justify-between items-center">
            <div className="flex gap-2">
              <div className="dropdown dropdown-hover">
                <label
                  tabIndex={0}
                  className="btn btn-sm border-none shadow-none bg-button-verba text-text-alt-verba hover:text-text-verba hover:bg-button-hover-verba"
                >
                  <IoMdAddCircle size={15} />
                  <p className="text-xs">Label</p>
                </label>
                <ul
                  tabIndex={0}
                  className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
                >
                  {labels.map((label, index) => (
                    <li key={"Label" + index}>
                      <a
                        onClick={() => {
                          if (!filterLabels.includes(label)) {
                            setFilterLabels([...filterLabels, label]);
                          }
                          const dropdownElement =
                            document.activeElement as HTMLElement;
                          dropdownElement.blur();
                          const dropdown = dropdownElement.closest(
                            ".dropdown"
                          ) as HTMLElement;
                          if (dropdown) dropdown.blur();
                        }}
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {(filterLabels.length > 0 || documentFilter.length > 0) && (
              <button
                onClick={() => {
                  setFilterLabels([]);
                  setDocumentFilter([]);
                }}
                className="btn btn-sm border-none shadow-none bg-button-verba text-text-alt-verba hover:text-text-verba hover:bg-button-hover-verba"
              >
                <MdCancel size={15} />
                <p className="text-xs">Clear Filters</p>
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {filterLabels.map((label, index) => (
              <button
                key={"FilterLabel" + index}
                onClick={() => {
                  setFilterLabels(filterLabels.filter((l) => l !== label));
                }}
                className="btn btn-sm border-none shadow-none text-text-alt-verba hover:text-text-verba bg-button-verba hover:bg-button-hover-verba"
              >
                <p className="text-xs truncate max-w-[200px]" title={label}>
                  {label}
                </p>
                <MdCancel size={15} />
              </button>
            ))}
            {documentFilter.map((filter, index) => (
              <button
                key={"DocumentFilter" + index}
                onClick={() => {
                  setDocumentFilter(
                    documentFilter.filter((f) => f.uuid !== filter.uuid)
                  );
                }}
                className="btn btn-sm border-none shadow-none text-text-alt-verba hover:text-text-verba bg-button-verba hover:bg-button-hover-verba"
              >
                <p
                  className="text-xs truncate max-w-[200px]"
                  title={filter.title}
                >
                  {filter.title}
                </p>
                <MdCancel size={15} />
              </button>
            ))}
          </div>
        </div>

        <div
          className={`${selectedSetting === "Chat" ? "flex flex-col gap-3 p-4" : "hidden"}`}
        >
          <div className="flex w-full justify-start items-center text-text-alt-verba gap-2">
            {currentDatacount === 0 && <BiError size={15} />}
            {currentDatacount === 0 && (
              <p className="text-text-alt-verba text-sm items-center flex">{`${currentDatacount} documents embedded by ${currentEmbedding}`}</p>
            )}
          </div>
          {messages.map((message, index) => (
            <div
              key={"Message_" + index}
              className={`${message.type === "user" ? "text-right" : ""}`}
            >
              <ChatMessage
                message={message}
                message_index={index}
                selectedTheme={selectedTheme}
                selectedDocument={selectedDocumentScore}
                setSelectedDocumentScore={setSelectedDocumentScore}
                setSelectedDocument={setSelectedDocument}
                setSelectedChunkScore={setSelectedChunkScore}
              />
            </div>
          ))}
          {previewText && (
            <ChatMessage
              message={{ type: "system", content: previewText, cached: false }}
              message_index={-1}
              selectedTheme={selectedTheme}
              selectedDocument={selectedDocumentScore}
              setSelectedDocumentScore={setSelectedDocumentScore}
              setSelectedDocument={setSelectedDocument}
              setSelectedChunkScore={setSelectedChunkScore}
            />
          )}
          {isFetching.current && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-text-alt-verba loading loading-dots loading-md"></span>
                <p className="text-text-alt-verba">
                  {fetchingStatus === "CHUNKS" && "Retrieving..."}
                  {fetchingStatus === "RESPONSE" && "Generating..."}
                </p>
                <button
                  onClick={() => {
                    setFetchingStatus("DONE");
                    isFetching.current = false;
                  }}
                  className="btn btn-circle btn-sm bg-bg-alt-verba hover:bg-warning-verba hover:text-text-verba text-text-alt-verba shadow-none border-none text-sm"
                >
                  <MdCancel size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
        {selectedSetting === "Config" && (
          <ChatConfig
            production={production}
            RAGConfig={RAGConfig}
            setRAGConfig={setRAGConfig}
            onReset={onResetConfig}
            onSave={onSaveConfig}
          />
        )}
      </div>

      <div className="bg-bg-alt-verba rounded-2xl flex gap-2 p-6 items-center justify-end h-min w-full">
        {socketOnline ? (
          <div className="flex gap-2 items-center justify-end w-full">
            <label className="input flex items-center gap-2 w-full bg-bg-verba">
              <input
                type="text"
                className="grow w-full placeholder-text-alt-verba"
                placeholder={
                  currentDatacount > 0
                    ? `Chatting with ${currentDatacount} documents...`
                    : `No documents detected...`
                }
                onKeyDown={handleKeyDown}
                value={userInput}
                onChange={(e) => {
                  setUserInput(e.target.value);
                }}
              />
            </label>

            <button
              type="button"
              onClick={(e) => {
                sendUserMessage();
              }}
              className="btn btn-square border-none text-text-verba bg-primary-verba hover:bg-button-hover-verba"
            >
              <IoIosSend size={15} />
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedDocument(null);
                setSelectedChunkScore([]);
                setSelectedDocumentScore(null);
                setMessages([
                  {
                    type: "system",
                    content: selectedTheme.intro_message.text,
                  },
                ]);
              }}
              className="btn btn-square text-text-alt-verba hover:text-text-verba border-none bg-button-verba hover:bg-button-hover-verba"
            >
              <MdOutlineRefresh size={18} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-center justify-end w-full">
            <button
              onClick={reconnectToVerba}
              className="flex btn border-none text-text-verba bg-button-verba hover:bg-button-hover-verba gap-2"
            >
              <TbPlugConnected size={15} />
              <p>Reconnect to Verba</p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;

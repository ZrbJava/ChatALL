import AsyncLock from "async-lock";
import axios from "axios";
import { SSE } from "sse.js";
import { v4 as uuidv4 } from "uuid";
import Bot, { LoginError } from "@/bots/Bot";
import i18n from "@/i18n";

export default class HuggingChatBot extends Bot {
  static _brandId = "huggingChat"; // Brand id of the bot, should be unique. Used in i18n.
  static _className = "HuggingChatBot"; // Class name of the bot
  static _logoFilename = "huggingchat-logo.png"; // Place it in public/bots/
  static _loginUrl = "https://huggingface.co/chat/";
  static _model = "OpenAssistant/oasst-sft-6-llama-30b-xor";
  static _lock = new AsyncLock(); // AsyncLock for prompt requests

  constructor() {
    super();
  }

  /**
   * Check whether the bot is logged in, settings are correct, etc.
   * @returns {boolean} - true if the bot is available, false otherwise.
   */
  async _checkAvailability() {
    // Create a conversation to test if the bot is available
    const conversationId = await this.createChatContext();
    let available = false;

    if (conversationId) {
      available = true;
      // Delete the conversation after testing
      axios.delete(
        `https://huggingface.co/chat/conversation/${conversationId}`,
      );
    }

    return available;
  }

  packRequest(prompt) {
    return {
      inputs: prompt,
      parameters: {
        temperature: 0.9,
        truncate: 1000,
        max_new_tokens: 1024,
        stop: ["</s>"],
        top_p: 0.95,
        repetition_penalty: 1.2,
        top_k: 50,
        return_full_text: false,
      },
      stream: true,
      options: {
        id: uuidv4(),
        is_retry: false,
        use_cache: false,
      },
    };
  }
  /**
   * Send a prompt to the bot and call onResponse(response, callbackParam)
   * when the response is ready.
   * @param {string} prompt
   * @param {function} onUpdateResponse params: callbackParam, Object {content, done}
   * @param {object} callbackParam - Just pass it to onUpdateResponse() as is
   */
  async _sendPrompt(prompt, onUpdateResponse, callbackParam) {
    const conversationId = await this.getChatContext();
    return new Promise((resolve, reject) => {
      (async () => {
        if (!conversationId) {
          reject(new Error(i18n.global.t("bot.failedToCreateConversation")));
        }

        const source = new SSE(
          `https://huggingface.co/chat/conversation/${conversationId}`,
          {
            headers: { "Content-Type": "application/json" },
            payload: JSON.stringify(this.packRequest(prompt)),
          },
        );

        let text = "";
        source.addEventListener("message", (event) => {
          const data = JSON.parse(event.data);
          if (data.generated_text === null) {
            text += data.token.text;
            onUpdateResponse(callbackParam, { content: text, done: false });
          } else {
            // the last message
            onUpdateResponse(callbackParam, {
              content: data.generated_text,
              done: true,
            });
            source.close();
            resolve();
          }
        });

        source.addEventListener("error", (error) => {
          source.close();
          const data = JSON.parse(error.data);
          if (data.message === "Exceeded number of messages before login") {
            reject(new LoginError(data.message));
          } else if (data.message) {
            reject(new Error(data.message));
          } else {
            reject(error);
          }
        });

        source.stream();
      })();
    });
  }

  /**
   * Should implement this method if the bot supports conversation.
   * The conversation structure is defined by the subclass.
   * @param null
   * @returns {any} - Conversation structure. null if not supported.
   */
  async createChatContext() {
    let conversationId = "";
    await axios
      .post("https://huggingface.co/chat/conversation", {
        model: this.constructor._model,
      })
      .then(({ data: resp }) => {
        conversationId = resp.conversationId;
      })
      .catch((error) => {
        console.error(error);
        throw error;
      });
    return conversationId;
  }
}
